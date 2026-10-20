"""A ValKey server that misbehaves on purpose, for the tests of how the store copes

It speaks just enough of the wire protocol for the client to talk to it: it reads each command
and answers MGET and SET the way a healthy server would, or the way its mode says. A mode can also
be a mapping from a command's name to the mode for that command, as when a server out of memory
still answers reads but refuses writes, with every other command answered as a healthy server would
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

# Replies sent as they are, for the failures a real server reports in-band
OUT_OF_MEMORY = b"-OOM command not allowed when used memory > 'maxmemory'.\r\n"
STILL_LOADING = b"-LOADING Valkey is loading the dataset in memory\r\n"
READ_ONLY = b"-READONLY You can't write against a read only replica.\r\n"
NOT_A_REPLY = b"!this is not a reply\r\n"

# Modes that act instead of replying with fixed bytes. EMPTY answers like a working server holding
# no keys
ANSWER = "answer"
EMPTY = "empty"
STALL = "stall"
LATE = "late"
TRICKLE = "trickle"

# Longer than the store's operation timeout, so the client has given up before a late reply is sent
LATE_REPLY_DELAY_SECONDS = 0.6

# Each byte of a trickled reply comes sooner than the operation timeout, but together they take longer
TRICKLE_BYTE_DELAY_SECONDS = 0.05

type Mode = str | bytes | dict[bytes, str | bytes]


class FakeValkeyServer:
    """Answers each connection according to the mode at its position in the list

    Attributes:
        url: Address the store connects to
        modes: Mode per connection, in the order they connect. The last one serves any later ones
        connections: How many connections have been accepted
        commands: Every command received, in order
    """

    def __init__(self, modes: list[Mode]) -> None:
        """Remember the modes to serve, before the server has a port

        Args:
            modes: Mode per connection, in order
        """
        self.url = ""
        self.modes = modes
        self.connections = 0
        self.commands: list[list[bytes]] = []

    @property
    def data_commands(self) -> list[list[bytes]]:
        """Only the reads and writes, leaving out the setup commands the client sends on connecting"""
        return [command for command in self.commands if command[0].upper() in (b"MGET", b"SET")]

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Serve one connection until the client closes it"""
        mode = self.modes[min(self.connections, len(self.modes) - 1)]
        self.connections += 1
        try:
            while command := await _read_command(reader):
                self.commands.append(command)
                await _reply(writer, mode, command)
        except ConnectionError, asyncio.IncompleteReadError:
            pass
        finally:
            writer.close()


async def _read_command(reader: asyncio.StreamReader) -> list[bytes] | None:
    """Read one command, an array of bulk strings, or None when the client has closed"""
    header = await reader.readline()
    if not header:
        return None

    parts = []
    for _ in range(int(header[1:])):
        length = int((await reader.readline())[1:])
        parts.append((await reader.readexactly(length + 2))[:-2])
    return parts


def _healthy_reply(command: list[bytes]) -> bytes:
    """Return what a working server answers: each key read back as its own value, and OK to a write"""
    if command[0].upper() == b"MGET":
        keys = command[1:]
        return b"*%d\r\n" % len(keys) + b"".join(b"$%d\r\n%s\r\n" % (len(key), key) for key in keys)
    return b"+OK\r\n"


def _empty_reply(command: list[bytes]) -> bytes:
    """Return what a working server holding no keys answers: every key read back as absent, and OK to a write"""
    if command[0].upper() == b"MGET":
        return b"*%d\r\n" % (len(command) - 1) + b"$-1\r\n" * (len(command) - 1)
    return b"+OK\r\n"


async def _reply(writer: asyncio.StreamWriter, mode: Mode, command: list[bytes]) -> None:
    """Answer one command as the mode says"""
    if isinstance(mode, dict):
        mode = mode.get(command[0].upper(), ANSWER)

    if isinstance(mode, bytes):
        writer.write(mode)
    elif mode == EMPTY:
        writer.write(_empty_reply(command))
    elif mode == STALL:
        await asyncio.sleep(3600)
    elif mode == LATE:
        await asyncio.sleep(LATE_REPLY_DELAY_SECONDS)
        writer.write(_healthy_reply(command))
    elif mode == TRICKLE:
        for byte in _healthy_reply(command):
            writer.write(bytes([byte]))
            await writer.drain()
            await asyncio.sleep(TRICKLE_BYTE_DELAY_SECONDS)
    else:
        writer.write(_healthy_reply(command))
    await writer.drain()


@asynccontextmanager
async def fake_valkey_server(*modes: Mode) -> AsyncIterator[FakeValkeyServer]:
    """Run a server on a free port, answering each new connection in the next mode given

    Args:
        *modes: Mode per connection, in order. The last one serves any later ones
    """
    fake = FakeValkeyServer(list(modes))
    server = await asyncio.start_server(fake.handle, "127.0.0.1", 0)
    fake.url = f"valkey://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    try:
        yield fake
    finally:
        server.close()
        server.close_clients()
        await server.wait_closed()
