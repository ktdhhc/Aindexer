"""
Helper script to inspect and optionally terminate the process listening on port 8000.
Targeted for Windows environments using netstat and taskkill.
"""

import argparse
import subprocess
import sys
import re


def get_process_on_port(port: int) -> list[dict]:
    """
    Find processes listening on the specified port using netstat.
    Returns a list of dicts with 'line' and 'pid'.
    """
    try:
        # netstat -ano lists all connections and listening ports with PIDs
        output = subprocess.check_output(["netstat", "-ano"], text=True)
    except subprocess.CalledProcessError as e:
        print(f"Error running netstat: {e}", file=sys.stderr)
        return []

    results = []
    # Pattern to match the port and capture the PID at the end of the line
    # Example: TCP    127.0.0.1:8000         0.0.0.0:0              LISTENING       1234
    # We look for :8000 followed by whitespace or end of address
    # We also want to capture the state (LISTENING, ESTABLISHED, etc.)
    port_pattern = re.compile(rf":{port}\s+.*?\s+([A-Z_]+)\s+(\d+)$")

    for line in output.splitlines():
        line = line.strip()
        match = port_pattern.search(line)
        if match:
            state = match.group(1)
            pid = match.group(2)
            # Only care about LISTENING for freeing the port,
            # but might want to see others if they are blocking.
            # However, the task is to free the port, which usually means killing the listener.
            if state == "LISTENING" or pid != "0":
                results.append({"line": line, "pid": pid, "state": state})

    return results


def kill_process(pid: str, quiet: bool = False) -> bool:
    """
    Terminate the process with the given PID using taskkill.
    """
    try:
        if not quiet:
            print(f"Attempting to terminate process {pid}...")
        subprocess.check_call(
            ["taskkill", "/F", "/PID", pid],
            stdout=subprocess.DEVNULL if quiet else None,
            stderr=subprocess.DEVNULL if quiet else None,
        )
        return True
    except subprocess.CalledProcessError as e:
        if not quiet:
            print(f"Failed to kill process {pid}: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Free port 8000 on Windows.")
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to check (default: 8000)"
    )
    parser.add_argument(
        "--yes", "-y", action="store_true", help="Auto-confirm termination"
    )
    parser.add_argument("--quiet", "-q", action="store_true", help="Reduce output")
    args = parser.parse_args()

    processes = get_process_on_port(args.port)

    # Filter for LISTENING processes first as they are the primary targets
    listeners = [p for p in processes if p["state"] == "LISTENING"]
    others = [p for p in processes if p["state"] != "LISTENING"]

    if not processes:
        if not args.quiet:
            print(f"Port {args.port} is free.")
        sys.exit(0)

    if not args.quiet:
        print(f"Port {args.port} is occupied by the following process(es):")
        for p in processes:
            print(f"  {p['line']}")

    # Target listeners first
    targets = listeners if listeners else others

    for p in targets:
        pid = p["pid"]
        if pid == "0":
            continue

        if args.yes:
            kill_process(pid, args.quiet)
        else:
            try:
                confirm = (
                    input(f"Terminate process {pid} ({p['state']})? [y/N]: ")
                    .strip()
                    .lower()
                )
                if confirm == "y":
                    kill_process(pid, args.quiet)
                else:
                    if not args.quiet:
                        print(f"Skipping process {pid}.")
            except EOFError:
                if not args.quiet:
                    print("\nNo input received, skipping.")
                break

    # Final check
    remaining = get_process_on_port(args.port)
    if not remaining:
        if not args.quiet:
            print(f"Port {args.port} is now free.")
        sys.exit(0)
    else:
        if not args.quiet:
            print(f"Port {args.port} is still occupied.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
