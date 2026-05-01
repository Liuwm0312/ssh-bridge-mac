#!/usr/bin/env python3

import argparse
import fcntl
import os
import select
import signal
import struct
import subprocess
import sys
import termios


def set_winsize(fd, rows, cols):
    size = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, size)


def set_nonblocking(fd):
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def main():
    parser = argparse.ArgumentParser(description="Run a command behind a real PTY and bridge it over stdio.")
    parser.add_argument("--rows", type=int, default=40)
    parser.add_argument("--cols", type=int, default=120)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        print("pty-ssh-bridge requires a command", file=sys.stderr)
        return 2

    master_fd, slave_fd = os.openpty()
    set_winsize(slave_fd, args.rows, args.cols)

    child = subprocess.Popen(
        command,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        start_new_session=True,
    )
    os.close(slave_fd)

    set_nonblocking(master_fd)
    set_nonblocking(sys.stdin.fileno())

    exit_code = 0
    stdin_open = True
    try:
        while True:
            read_fds = [master_fd]
            if stdin_open:
                read_fds.append(sys.stdin.fileno())
            readable, _, _ = select.select(read_fds, [], [], 0.1)

            if master_fd in readable:
                try:
                    data = os.read(master_fd, 8192)
                except OSError:
                    data = b""
                if data:
                    os.write(sys.stdout.fileno(), data)
                else:
                    break

            if sys.stdin.fileno() in readable:
                try:
                    data = os.read(sys.stdin.fileno(), 8192)
                except OSError:
                    data = b""
                if data:
                    os.write(master_fd, data)
                else:
                    stdin_open = False

            code = child.poll()
            if code is not None:
                exit_code = code
                while True:
                    try:
                        data = os.read(master_fd, 8192)
                    except OSError:
                        data = b""
                    if not data:
                        break
                    os.write(sys.stdout.fileno(), data)
                break
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except OSError:
                pass
            child.wait(timeout=2)

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
