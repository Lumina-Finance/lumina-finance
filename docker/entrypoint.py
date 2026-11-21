"""Prepares the data volume, keys and database, then runs the web server, the app and the bank sync worker

The container's first process. Started as root, it hands the data volume to the image's unprivileged
user and becomes that user before anything else runs, so no process that serves a request is root
"""

# Starting fixed commands without a shell is all this file does, and none of them takes outside input
# ruff: noqa: S603, S606, S607

import os
import signal
import stat
import subprocess
import sys
from pathlib import Path

# The unprivileged user and group the base image ships, and its home, where the web server keeps its state
APP_UID = 65532
APP_GID = 65532
APP_HOME = "/home/nonroot"

DATA_DIR = Path("/data")

# A command line the container doesn't take, as sysexits names it
EXIT_USAGE = 64

# What `app.worker check-providers` exits with when no bank provider is enabled
EXIT_NO_PROVIDER = 69

# A data folder the app can't use, as sysexits names a setup problem
EXIT_CONFIG = 78

# What to do about a data folder the app's user can't be given, or can't use once given it
CHOWN_FIX = (
    f"Please give user {APP_UID} the folder mounted at /data on the host, with sudo chown -R {APP_UID}:{APP_GID} "
    "<folder>, or keep the folder on a disk that allows a change of owner."
)

# Owner-only read and write, for the token signing keys
PRIVATE_KEY_MODE = 0o600

# Maintenance commands, run against a stopped stack as `docker compose run --rm app <command>`, and the
# bank sync worker for a deployment that runs it in its own container. Matched against this list rather
# than run as given, since this container starts with the admin database credentials and the data volume,
# and passing arbitrary arguments through would make it a shell on both
COMMANDS = ("generate-app-encryption-key", "rotate-app-encryption-key", "reset-bank-transaction-hash-key", "worker")

UVICORN_COMMAND = (
    sys.executable,
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    "--timeout-keep-alive",
    "125",
    "--no-access-log",
)
CADDY_COMMAND = ("caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
WORKER_COMMAND = (sys.executable, "-m", "app.worker")
BOOTSTRAP_COMMAND = (sys.executable, "-m", "app.db.jobs", "bootstrap")
MIGRATE_COMMAND = (sys.executable, "-m", "app.db.jobs", "migrate")

# The admin database login. Only the steps that record the keys and create the roles use it. Once they
# are done, this script starts itself again without it, so no process that keeps running holds it, and
# this argument tells the second start that they are
ADMIN_LOGIN_SETTINGS = ("DB_USER", "DB_PASSWORD")
AFTER_ADMIN_STEPS = "--after-admin-steps"


class StopRequested(Exception):
    """The container was asked to stop, carrying the exit status a shell would report for the signal"""


def request_stop(signal_number: int, _frame) -> None:
    """Interrupt whatever the entrypoint is waiting on, so it can stop its children in order"""
    raise StopRequested(128 + signal_number)


def stop_for_data_folder(path: str, reason: str, fix: str) -> None:
    """Stop the container with a message saying which part of the data folder failed and how to fix it"""
    print(f"Lumina Finance can't use {path}: {reason}.", file=sys.stderr)
    print(fix, file=sys.stderr)
    sys.exit(EXIT_CONFIG)


def is_read_only() -> bool:
    """Return whether the data folder is mounted read-only"""
    return DATA_DIR.is_dir() and bool(os.statvfs(DATA_DIR).f_flag & os.ST_RDONLY)


def stop_if_read_only() -> None:
    """Stop with the mount fix when the data folder is read-only, since no change of owner would help"""
    if is_read_only():
        stop_for_data_folder(
            str(DATA_DIR),
            "it is mounted read-only",
            f"Please remove :ro from the {DATA_DIR} mount in your Compose file, since keys and secrets are written there.",
        )


def raise_walk_error(error: OSError) -> None:
    """Stop a walk of the data folder at a directory it can't open, rather than skip the directory

    The walk names a subdirectory only by its name inside its parent, so the whole folder is named instead
    """
    if not (isinstance(error.filename, str) and os.path.isabs(error.filename)):
        error.filename = str(DATA_DIR)
    raise error


def adopt_data_volume() -> None:
    """Give the app user whatever on the data volume it doesn't own yet

    An image before this one ran as root and wrote the volume as root, and a fresh volume starts out
    root-owned. Only the owner changes, never a mode, so files kept private stay private

    Walked through directory handles and never through a link, so a link someone with the app user's
    rights swaps in while this runs as root can't hand them a file outside the volume
    """
    # A read-only folder can't change owner. It is left as it is, so a worker that only reads it still
    # starts, and the app's own start reports the read-only mount
    if is_read_only():
        return

    path = str(DATA_DIR)
    try:
        for directory, subdirectories, files, directory_fd in os.fwalk(DATA_DIR, onerror=raise_walk_error):
            path = directory
            status = os.fstat(directory_fd)
            if (status.st_uid, status.st_gid) != (APP_UID, APP_GID):
                os.fchown(directory_fd, APP_UID, APP_GID)

            # A real directory is adopted on its own turn of the walk. A link to one is listed among the
            # directories but never walked, so it is adopted here with the files
            for name in (*subdirectories, *files):
                path = os.path.join(directory, name)
                status = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                is_owned = (status.st_uid, status.st_gid) == (APP_UID, APP_GID)
                if not is_owned and not stat.S_ISDIR(status.st_mode):
                    os.chown(name, APP_UID, APP_GID, dir_fd=directory_fd, follow_symlinks=False)
    except OSError as error:
        # A failed walk names a path in full, and a failed change of owner names only the entry
        stop_for_data_folder(
            error.filename if isinstance(error.filename, str) and os.path.isabs(error.filename) else path,
            f"it couldn't be given to the app's user, {APP_UID} ({error.strerror})",
            CHOWN_FIX,
        )


def check_data_folder() -> None:
    """Stop with a message when the user the app runs as can't open, list or write what start-up needs

    A start-up that finds out partway would stop with a traceback instead. Directories need reading,
    writing and opening, since keys and secrets are added to them, and files only reading
    """
    stop_if_read_only()
    try:
        for directory, _subdirectories, files, directory_fd in os.fwalk(DATA_DIR, onerror=raise_walk_error):
            if not os.access(directory, os.R_OK | os.W_OK | os.X_OK):
                raise PermissionError(13, "Permission denied", directory)
            for name in files:
                if not os.access(name, os.R_OK, dir_fd=directory_fd, follow_symlinks=False):
                    raise PermissionError(13, "Permission denied", os.path.join(directory, name))
    except OSError as error:
        uid, gid = os.getuid(), os.getgid()
        if uid == APP_UID:
            fix = CHOWN_FIX
        else:
            fix = (
                f"Please remove the user: line from the app in your Compose file, so the app takes over {DATA_DIR} "
                f"itself, or give user {uid} the folder on the host, with sudo chown -R {uid}:{gid} <folder>."
            )
        stop_for_data_folder(error.filename or str(DATA_DIR), f"user {uid} can't use it ({error.strerror})", fix)


def drop_privileges() -> None:
    """Become the app user when started as root, after adopting the data volume

    A container started as another user, as some hosts require, keeps that user
    """
    if os.getuid() != 0:
        return

    adopt_data_volume()
    os.setgroups([])
    os.setgid(APP_GID)
    os.setuid(APP_UID)
    os.environ["HOME"] = APP_HOME


def run(*command: str) -> None:
    """Run one set-up step, stopping the container with its status when it fails

    A stop request waits for the step to finish, so a migration or a key being written is never cut
    short, and then stops the container with the request's status
    """
    process = subprocess.Popen(command)
    stop = None
    while True:
        try:
            status = process.wait()
            break
        except StopRequested as requested:
            stop = requested
    if stop is not None:
        raise stop
    if status != 0:
        sys.exit(status)


def environment_without_admin_login() -> dict[str, str]:
    """Return this process's environment with the admin database login taken out"""
    return {name: value for name, value in os.environ.items() if name not in ADMIN_LOGIN_SETTINGS}


def replace_process(*command: str) -> None:
    """Replace this process with a command that never needs the admin database login, and so never holds it"""
    os.execve(sys.executable, (sys.executable, *command), environment_without_admin_login())


def run_command(arguments: list[str]) -> None:
    """Replace this process with the maintenance command or worker named, refusing anything else"""
    command, extra_arguments = arguments[0], arguments[1:]
    if command not in COMMANDS:
        print(f"Unknown command: {command}", file=sys.stderr)
        print(f"Available: {', '.join(COMMANDS)}", file=sys.stderr)
        sys.exit(EXIT_USAGE)

    # Only rotation takes anything after the command name: the new key. The others reject it
    # rather than drop it, so a mistyped invocation never prints a fresh key and exits as though it worked
    if extra_arguments and command != "rotate-app-encryption-key":
        print(f"{command} takes no arguments", file=sys.stderr)
        sys.exit(EXIT_USAGE)

    if command == "worker":
        # Skips the app's start-up: the worker needs no token signing keys, and waits for the app to
        # create the database roles and migrate before it claims any job
        replace_process(*WORKER_COMMAND[1:])
    if command == "generate-app-encryption-key":
        replace_process("-m", "scripts.generate_app_encryption_key")
    if command == "rotate-app-encryption-key":
        replace_process("-m", "scripts.rotate_app_encryption_key", *extra_arguments)

    # Binds the database to the key now set, generating one when none is, for a deployment that has
    # lost the old one. Statements imported again then bring back the transactions already saved from
    # them. The next bank sync sends the transactions it fetches again back for review, even those
    # approved, and the bank's corrections and removals stop reaching the saved ones. That is why it is
    # never automatic. The reset records the key as the migrator, the record's owner. A lost data
    # volume or a dump restored onto a new host has neither the migrator's password nor its ownership
    # yet, so they are set up as a normal start would, as the admin role
    run(*BOOTSTRAP_COMMAND)
    replace_process("-m", "app.db.bank_transaction_key", "reset-key")


def is_bank_sync_worker_enabled() -> bool:
    """Read RUN_BANK_SYNC_WORKER like the app's other switches, refusing anything but true or false

    Case and surrounding spaces are ignored, and blank keeps the default of true. A typo is refused so
    it never leaves bank sync silently off
    """
    value = os.environ.get("RUN_BANK_SYNC_WORKER", "").strip().lower() or "true"
    if value not in ("true", "false"):
        print(f"RUN_BANK_SYNC_WORKER must be true or false, not '{value}'", file=sys.stderr)
        sys.exit(EXIT_USAGE)
    return value == "true"


def is_valid_private_key(path: Path) -> bool:
    """Return whether OpenSSL can parse and validate the key at the path"""
    try:
        if path.stat().st_size == 0:
            return False
    except OSError:
        return False

    checked = subprocess.run(
        ("openssl", "pkey", "-in", str(path), "-check", "-noout"),
        capture_output=True,
        check=False,
    )
    return checked.returncode == 0


def ensure_private_key(name: str, path: Path) -> None:
    """Keep a valid token signing key, replacing an invalid one and generating a missing one"""
    if path.exists() or path.is_symlink():
        if is_valid_private_key(path):
            return
        print(f"{name} token signing key is invalid, removing and generating one...")
        path.unlink()
    else:
        print(f"{name} token signing key not found, generating one...")

    # Written to a temporary file first so a partly generated key is never kept
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.tmp")
    temporary_path.unlink(missing_ok=True)
    run("openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:4096", "-out", str(temporary_path))
    temporary_path.chmod(PRIVATE_KEY_MODE)
    temporary_path.replace(path)
    print(f"Generated {name} token signing key at {path}")


def prepare_as_admin() -> None:
    """Take the steps that need the admin database login, then start this script again without it

    The first process holds the login for these steps only. The process that replaces it, with the same
    process ID, never has it, and neither has anything it starts
    """
    # Refused here, before anything is changed, as the rest of the start would
    is_bank_sync_worker_enabled()

    ensure_private_key("Access", Path(os.environ["JWT_ACCESS_PRIVATE_KEY_PATH"]))
    ensure_private_key("Refresh", Path(os.environ["JWT_REFRESH_PRIVATE_KEY_PATH"]))

    # The encryption key protects TOTP secrets and OIDC client secrets at rest, generated and persisted
    # next to the role secrets when absent. A database that already holds encrypted secrets refuses
    # here rather than starting under a key that cannot read them
    run(sys.executable, "-m", "app.db.encryption_key", "ensure-key")

    # The key the bank transaction hashes of OFX imports are made with, generated and persisted beside
    # the encryption key when absent. A database that already has a key refuses here rather than
    # starting under a new one none of its hashes match, and the app refuses at start when the key set
    # is not the one recorded. The migrations need it to hash transactions saved before
    run(sys.executable, "-m", "app.db.bank_transaction_key", "ensure-key")

    # The first of the two set-up jobs creates the migrator and app roles and hands them schema ownership
    # while connected as the admin role. It is the last step that needs the login
    run(*BOOTSTRAP_COMMAND)
    replace_process(str(Path(__file__).resolve()), AFTER_ADMIN_STEPS)


def prepare() -> bool:
    """Migrate the database, and return whether this container runs the bank sync worker

    The second set-up job runs as the migrator: migrations, then the row-level security policies, then
    the encryption key's fingerprint, and then the reference data. The fingerprint step stops the start
    when the key in hand is not the one the data is under
    """
    is_worker_enabled = is_bank_sync_worker_enabled()
    run(*MIGRATE_COMMAND)

    if not is_worker_enabled:
        return False

    # With no bank provider enabled the worker has nothing to sync, so this container doesn't start it.
    # A provider whose settings are refused stops the container here, before it serves, as it would
    # stop the worker
    providers_status = subprocess.run((sys.executable, "-m", "app.worker", "check-providers"), check=False).returncode
    if providers_status == EXIT_NO_PROVIDER:
        return False
    if providers_status != 0:
        sys.exit(providers_status)
    return True


def exit_status(wait_status: int) -> int:
    """Turn a wait status into the exit status a shell would report for it"""
    code = os.waitstatus_to_exitcode(wait_status)
    return 128 - code if code < 0 else code


def serve(is_worker_here: bool) -> int:
    """Run the app, the web server and the worker until one exits or the container is asked to stop

    Returns:
        The exit status of the process that ended first, or of the stop request
    """
    # Caddy serves the frontend and proxies /api to this local Uvicorn process. Uvicorn keeps an idle
    # connection longer than Caddy's two minutes, so Caddy is always the side that closes it. The other
    # way round, a request Caddy sends just as Uvicorn closes the connection is reset, and Caddy answers
    # it with a 502 that a POST such as the session refresh never retries. Its access log stays off since
    # each of its lines holds the full path and query string
    children = []
    try:
        children.append(subprocess.Popen(UVICORN_COMMAND))
        children.append(subprocess.Popen(CADDY_COMMAND))

        # Started after the migrations, so it claims no job before the schema is current. A job cut
        # short when the container stops is claimed again once its lease runs out
        if is_worker_here:
            children.append(subprocess.Popen(WORKER_COMMAND))

        # As the container's first process this also reaps orphans. They belong to none of the three, so the
        # wait carries on
        child_ids = {child.pid for child in children}
        while True:
            pid, wait_status = os.wait()
            if pid in child_ids:
                status = exit_status(wait_status)
                break
    except StopRequested as stop:
        status = stop.args[0]

    # The worker finishes the job it is running before it stops, within the stop grace period
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        child.wait()
    return status


def main() -> None:
    """Run the command the container was started with, or prepare and serve the app"""
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    os.environ["JWT_ACCESS_PRIVATE_KEY_PATH"] = os.environ.get("JWT_ACCESS_PRIVATE_KEY_PATH") or "/data/keys/access_private.pem"
    os.environ["JWT_REFRESH_PRIVATE_KEY_PATH"] = os.environ.get("JWT_REFRESH_PRIVATE_KEY_PATH") or "/data/keys/refresh_private.pem"

    try:
        drop_privileges()
        is_after_admin_steps = sys.argv[1:] == [AFTER_ADMIN_STEPS]
        if len(sys.argv) > 1 and not is_after_admin_steps:
            run_command(sys.argv[1:])
        # Only the app's own start is checked, since a worker given its database passwords in settings
        # can run with no data folder at all
        check_data_folder()
        if not is_after_admin_steps:
            prepare_as_admin()
        sys.exit(serve(prepare()))
    except StopRequested as stop:
        sys.exit(stop.args[0])


if __name__ == "__main__":
    main()
