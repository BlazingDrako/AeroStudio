#!/usr/bin/env python3
"""Serve Pteronautics locally (browsers require a server for JavaScript modules and workers).

Usage:  python3 serve.py [port] [--no-browser]      then open http://localhost:8765

If Pteronautics is already running on the port, this just opens it in the browser.
If the port is taken by something else, the next free port is used.
"""
import http.server
import os
import socketserver
import sys
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8765
OPEN = "--no-browser" not in sys.argv


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # always serve fresh files so edits show up on reload
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


Handler.extensions_map.update({".js": "text/javascript", ".mjs": "text/javascript"})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    # the app loads ~80 module files at once; the default backlog of 5 makes some connections reset
    request_queue_size = 128


def already_running(port):
    """True if an Pteronautics server already answers on this port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=0.6) as r:
            return b"Pteronautics" in r.read(4000)
    except Exception:
        return False


if __name__ == "__main__":
    for port in range(PORT, PORT + 20):
        if already_running(port):
            url = f"http://localhost:{port}"
            print(f"Pteronautics is already running at {url}")
            if OPEN:
                webbrowser.open(url)
            sys.exit(0)
        try:
            httpd = Server(("127.0.0.1", port), Handler)
        except OSError:
            continue  # port busy with something else; try the next one
        url = f"http://localhost:{port}"
        print(f"Pteronautics running at {url}  (Ctrl+C or close this window to stop)")
        if OPEN:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.server_close()
        sys.exit(0)
    print("Could not find a free port between", PORT, "and", PORT + 19)
    sys.exit(1)
