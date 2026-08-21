"""A minimal pty host for platforms whose `script` needs a tty on stdin (BSD/macOS).

Runs $CAPTURE_CMD under `sh -c` inside a fresh pty, pumps the pty's output to
stdout unbuffered, and forwards stdin to the pty so keys can be typed into the
session. Exits with the command's exit status.

`pty.fork()` rather than `pty.openpty()` + subprocess: the fork makes the pty
the child's controlling terminal, so closing the master hangs the session up
(SIGHUP) the way a real terminal would. Without that, a stopped recording
leaves its dev server running forever.
"""

import os
import pty
import select
import signal
import sys

command = os.environ["CAPTURE_CMD"]
pid, master = pty.fork()
if pid == 0:
    os.execvp("sh", ["sh", "-c", command])

# A terminated recording must hang the session up rather than orphan it.
signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))

out = sys.stdout.buffer
stdin_fd = sys.stdin.fileno()
readable = [master, stdin_fd]

try:
    while True:
        try:
            ready, _, _ = select.select(readable, [], [])
        except InterruptedError:
            continue
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:  # EIO: the child closed its side
                data = b""
            if not data:
                break
            out.write(data)
            out.flush()
        if stdin_fd in ready:
            data = os.read(stdin_fd, 65536)
            if data:
                os.write(master, data)
            else:
                readable = [master]
finally:
    os.close(master)

_, status = os.waitpid(pid, 0)
code = os.waitstatus_to_exitcode(status)
sys.exit(code if code >= 0 else 128 - code)
