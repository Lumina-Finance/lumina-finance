"""The container start-up's handling of a data folder the app can't use, and the order of its steps

Loaded from its file, since the image's start-up script isn't part of the backend package. Owners and
permissions are stood in for, since the tests may run as root, and no permission refuses root
"""

import importlib.util
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_ENTRYPOINT = Path(__file__).parents[2] / "docker" / "entrypoint.py"


@pytest.fixture
def entrypoint(tmp_path, monkeypatch):
    """The start-up script with its data folder in a temporary directory holding one key"""
    spec = importlib.util.spec_from_file_location("entrypoint", _ENTRYPOINT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = tmp_path / "data"
    (data / "keys").mkdir(parents=True)
    (data / "keys" / "access_private.pem").write_text("key")
    monkeypatch.setattr(module, "DATA_DIR", data)
    return module


def _deny(path: str, refused_mode: int):
    """Stand in for os.access refusing one kind of access to the path given, and allowing everything else

    An entry checked through its directory's handle is matched by its name alone
    """

    def access(name, mode, *, dir_fd=None, follow_symlinks=True):
        is_path = str(name) == (os.path.basename(path) if dir_fd is not None else path)
        return not (is_path and mode & refused_mode)

    return access


def _refuse(*_arguments, **_options):
    """Stand in for a change of owner the disk refuses"""
    raise PermissionError(1, "Operation not permitted")


def test_a_refused_change_of_owner_stops_with_the_folder_and_the_fix(entrypoint, monkeypatch, capsys):
    """A share refusing the takeover, such as NFS with root squashing, gets the chown to run on the host"""
    monkeypatch.setattr(os, "fchown", _refuse)
    monkeypatch.setattr(os, "chown", _refuse)

    with pytest.raises(SystemExit) as stopped:
        entrypoint.adopt_data_volume()

    assert stopped.value.code == 78
    error = capsys.readouterr().err
    assert f"can't use {entrypoint.DATA_DIR}: it couldn't be given to the app's user, 65532" in error
    assert "Operation not permitted" in error
    assert "sudo chown -R 65532:65532 <folder>" in error


def test_a_refused_change_of_owner_of_a_file_names_the_file(entrypoint, monkeypatch, capsys):
    """A file the takeover can't change is named in full, not by its name inside its directory"""
    monkeypatch.setattr(os, "fchown", lambda *_arguments: None)
    monkeypatch.setattr(os, "chown", _refuse)

    with pytest.raises(SystemExit) as stopped:
        entrypoint.adopt_data_volume()

    assert stopped.value.code == 78
    key = entrypoint.DATA_DIR / "keys" / "access_private.pem"
    assert f"can't use {key}: it couldn't be given" in capsys.readouterr().err


def test_a_read_only_folder_still_owned_by_root_stops_with_the_mount_fix(entrypoint, monkeypatch, capsys):
    """A read-only folder an older image wrote is left as it is by the takeover, then told to drop :ro"""
    monkeypatch.setattr(os, "statvfs", lambda _path: SimpleNamespace(f_flag=os.ST_RDONLY))
    monkeypatch.setattr(os, "fchown", _refuse)
    monkeypatch.setattr(os, "chown", _refuse)

    entrypoint.adopt_data_volume()
    assert capsys.readouterr().err == ""

    with pytest.raises(SystemExit) as stopped:
        entrypoint.check_data_folder()

    assert stopped.value.code == 78
    error = capsys.readouterr().err
    assert "it is mounted read-only" in error
    assert "chown" not in error


def test_a_data_folder_the_takeover_cant_open_stops_with_the_folder(entrypoint, monkeypatch, capsys):
    """A directory the walk can't open stops the start, rather than being skipped and failing later"""
    missing = entrypoint.DATA_DIR / "absent"
    monkeypatch.setattr(entrypoint, "DATA_DIR", missing)

    with pytest.raises(SystemExit) as stopped:
        entrypoint.adopt_data_volume()

    assert stopped.value.code == 78
    assert f"can't use {missing}: it couldn't be given" in capsys.readouterr().err


def test_a_subdirectory_the_walk_cant_open_names_the_whole_folder(entrypoint, monkeypatch, capsys):
    """The walk names a subdirectory it can't open only by its own name, so the whole folder is named"""
    real_walk = os.fwalk

    def walk(top, onerror):
        # The top folder's listing comes first, naming a sibling that is fine, then a subdirectory fails
        walking = real_walk(top)
        yield next(walking)
        onerror(PermissionError(13, "Permission denied", "secrets"))

    monkeypatch.setattr(os, "fwalk", walk)
    monkeypatch.setattr(os, "fchown", lambda *_arguments: None)
    monkeypatch.setattr(os, "chown", lambda *_arguments, **_options: None)

    with pytest.raises(SystemExit) as stopped:
        entrypoint.adopt_data_volume()

    assert stopped.value.code == 78
    assert f"can't use {entrypoint.DATA_DIR}: it couldn't be given" in capsys.readouterr().err


def test_a_user_line_with_an_unreadable_file_stops_with_both_fixes(entrypoint, monkeypatch, capsys):
    """A container forced to another user is told to drop the user: line or give that user the folder"""
    key = str(entrypoint.DATA_DIR / "keys" / "access_private.pem")
    monkeypatch.setattr(os, "getuid", lambda: 1000)
    monkeypatch.setattr(os, "getgid", lambda: 1000)
    monkeypatch.setattr(os, "access", _deny(key, os.R_OK))

    with pytest.raises(SystemExit) as stopped:
        entrypoint.check_data_folder()

    assert stopped.value.code == 78
    error = capsys.readouterr().err
    assert f"can't use {key}: user 1000 can't use it" in error
    assert "Please remove the user: line" in error
    assert "sudo chown -R 1000:1000 <folder>" in error


def test_a_takeover_the_disk_ignored_stops_with_the_chown_fix(entrypoint, monkeypatch, capsys):
    """The app's own user still unable to write a directory gets the chown fix, never the user: line"""
    keys = str(entrypoint.DATA_DIR / "keys")
    monkeypatch.setattr(os, "getuid", lambda: 65532)
    monkeypatch.setattr(os, "getgid", lambda: 65532)
    monkeypatch.setattr(os, "access", _deny(keys, os.W_OK))

    with pytest.raises(SystemExit) as stopped:
        entrypoint.check_data_folder()

    assert stopped.value.code == 78
    error = capsys.readouterr().err
    assert f"can't use {keys}: user 65532 can't use it" in error
    assert "sudo chown -R 65532:65532 <folder>" in error
    assert "user: line" not in error


def test_a_read_only_data_folder_stops_with_the_mount_fix(entrypoint, monkeypatch, capsys):
    """A folder mounted read-only is told to drop :ro, since no owner change would help"""
    monkeypatch.setattr(os, "statvfs", lambda _path: SimpleNamespace(f_flag=os.ST_RDONLY))

    with pytest.raises(SystemExit) as stopped:
        entrypoint.check_data_folder()

    assert stopped.value.code == 78
    assert "it is mounted read-only" in capsys.readouterr().err


def test_a_usable_data_folder_lets_the_start_carry_on(entrypoint, capsys):
    """A folder the app's user can use passes without a message"""
    assert entrypoint.check_data_folder() is None
    assert capsys.readouterr().err == ""


_ADMIN_LOGIN = {"DB_USER": "postgres", "DB_PASSWORD": "admin-secret"}


class _ProcessReplaced(Exception):
    """Stands for the entrypoint becoming another command, after which none of its code runs"""


def _record_steps(entrypoint, monkeypatch) -> tuple[list[tuple[str, ...]], list[dict[str, str]]]:
    """Stand in for every step the start-up takes

    Returns the list each step is added to as it runs, and the environment of each process that replaces
    the entrypoint, in the order they started
    """
    steps: list[tuple[str, ...]] = []
    environments: list[dict[str, str]] = []

    def replace(_interpreter, command, environment):
        steps.append(tuple(command[1:]))
        environments.append(environment)
        # The real call never returns, since the process becomes the command
        raise _ProcessReplaced

    monkeypatch.setenv("RUN_BANK_SYNC_WORKER", "false")
    monkeypatch.setenv("JWT_ACCESS_PRIVATE_KEY_PATH", "/keys/access.pem")
    monkeypatch.setenv("JWT_REFRESH_PRIVATE_KEY_PATH", "/keys/refresh.pem")
    for name, value in _ADMIN_LOGIN.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(entrypoint, "ensure_private_key", lambda name, _path: steps.append((f"{name} signing key",)))
    monkeypatch.setattr(entrypoint, "run", lambda _interpreter, *arguments: steps.append(arguments))
    monkeypatch.setattr(os, "execve", replace)
    return steps, environments


def test_the_steps_that_need_the_admin_login_come_first_and_hand_the_start_to_a_process_without_it(entrypoint, monkeypatch):
    """Keys and the roles in the order the image always had, then the same script again with no admin login"""
    steps, environments = _record_steps(entrypoint, monkeypatch)

    with pytest.raises(_ProcessReplaced):
        entrypoint.prepare_as_admin()

    assert steps == [
        ("Access signing key",),
        ("Refresh signing key",),
        ("-m", "app.db.encryption_key", "ensure-key"),
        ("-m", "app.db.bank_transaction_key", "ensure-key"),
        ("-m", "app.db.jobs", "bootstrap"),
        (str(Path(entrypoint.__file__).resolve()), "--after-admin-steps"),
    ]
    assert not set(_ADMIN_LOGIN) & set(environments[0]), "the process that replaces the entrypoint holds no admin login"
    assert environments[0]["JWT_ACCESS_PRIVATE_KEY_PATH"] == "/keys/access.pem", "and keeps the rest of the environment"


def test_the_migration_is_the_next_step_and_runs_without_the_admin_login(entrypoint, monkeypatch):
    """After the roles come the migrations, so the image's order holds, run by a process that never held the login"""
    steps, _environments = _record_steps(entrypoint, monkeypatch)

    entrypoint.prepare()

    assert steps == [("-m", "app.db.jobs", "migrate")]


def test_a_start_after_the_admin_steps_takes_none_of_them_again(entrypoint, monkeypatch):
    """The second start of the script goes straight to migrating and serving, never asking for the admin login"""
    steps, _environments = _record_steps(entrypoint, monkeypatch)
    for name in _ADMIN_LOGIN:
        monkeypatch.delenv(name)
    monkeypatch.setattr(sys, "argv", ["entrypoint.py", "--after-admin-steps"])
    monkeypatch.setattr(entrypoint, "drop_privileges", lambda: None)
    monkeypatch.setattr(entrypoint, "check_data_folder", lambda: None)
    monkeypatch.setattr(entrypoint, "serve", lambda _is_worker_here: 0)

    with pytest.raises(SystemExit) as stop:
        entrypoint.main()

    assert stop.value.code == 0
    assert steps == [("-m", "app.db.jobs", "migrate")], "only the migration ran"


def test_a_second_start_given_by_hand_with_the_admin_login_still_drops_it(entrypoint, monkeypatch):
    """The argument skips the admin steps but never keeps the login in the processes that serve"""
    steps, environments = _record_steps(entrypoint, monkeypatch)
    monkeypatch.setattr(sys, "argv", ["entrypoint.py", "--after-admin-steps"])
    monkeypatch.setattr(entrypoint, "drop_privileges", lambda: None)
    monkeypatch.setattr(entrypoint, "check_data_folder", lambda: None)
    monkeypatch.setattr(entrypoint, "serve", lambda _is_worker_here: 0)

    with pytest.raises(_ProcessReplaced):
        entrypoint.main()

    assert steps == [(str(Path(entrypoint.__file__).resolve()), "--after-admin-steps")], "no admin step ran, and it started again"
    assert not set(_ADMIN_LOGIN) & set(environments[0]), "without the login"


def test_a_plain_start_takes_the_admin_steps(entrypoint, monkeypatch):
    """With no argument, the script begins with the steps that need the admin login"""
    steps, _environments = _record_steps(entrypoint, monkeypatch)
    monkeypatch.setattr(sys, "argv", ["entrypoint.py"])
    monkeypatch.setattr(entrypoint, "drop_privileges", lambda: None)
    monkeypatch.setattr(entrypoint, "check_data_folder", lambda: None)
    monkeypatch.setattr(entrypoint, "serve", lambda _is_worker_here: 0)

    with pytest.raises(_ProcessReplaced):
        entrypoint.main()

    assert ("-m", "app.db.jobs", "bootstrap") in steps, "the roles were set up"


def test_resetting_the_bank_transaction_hash_key_sets_up_the_roles_first(entrypoint, monkeypatch):
    """A lost data volume has neither role password nor ownership, so the reset gets the roles as a start would"""
    steps, environments = _record_steps(entrypoint, monkeypatch)

    with pytest.raises(_ProcessReplaced):
        entrypoint.run_command(["reset-bank-transaction-hash-key"])

    assert steps == [("-m", "app.db.jobs", "bootstrap"), ("-m", "app.db.bank_transaction_key", "reset-key")]
    assert not set(_ADMIN_LOGIN) & set(environments[0]), "the reset runs as the migrator, with no admin login"


@pytest.mark.parametrize(
    ("arguments", "expected"),
    [
        (["worker"], ("-m", "app.worker")),
        (["generate-app-encryption-key"], ("-m", "scripts.generate_app_encryption_key")),
        (["rotate-app-encryption-key", "new-key"], ("-m", "scripts.rotate_app_encryption_key", "new-key")),
    ],
)
def test_a_command_that_never_needs_the_admin_login_is_started_without_it(entrypoint, monkeypatch, arguments, expected):
    """The worker and the key commands connect as the app or the migrator, so no process of theirs holds the admin login"""
    steps, environments = _record_steps(entrypoint, monkeypatch)

    with pytest.raises(_ProcessReplaced):
        entrypoint.run_command(arguments)

    assert steps == [expected]
    assert not set(_ADMIN_LOGIN) & set(environments[0]), "the admin login was taken out of its environment"
