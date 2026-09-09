#!/usr/bin/env python3
"""
========================================================================================
🚀 R4U (Ruppee4U) Loan Application ERP — Unified Master Launcher
========================================================================================
Launches the entire project with a single command:
    python app.py

Features:
  - Automatic dependency check (Python & Node/npm)
  - Automatic `npm install` if node_modules is missing
  - Port availability check (5000 for FastAPI, 5173 for Vite)
  - Concurrent backend and frontend process management
  - Graceful shutdown on Ctrl+C (cleans up all child processes on Windows & Linux)
  - Automatic browser launch to http://localhost:5173
  - Real-time unified logging
========================================================================================
"""

import os
import sys
import time
import socket
import signal
import shutil
import argparse
import webbrowser
import subprocess
import threading

# Reconfigure stdout/stderr to UTF-8 on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# ANSI Colors for terminal output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

def colorize(text, color):
    if sys.platform == 'win32':
        # Enable ANSI support in Windows console
        os.system('')
    return f"{color}{text}{Colors.ENDC}"

def print_banner():
    banner = f"""
{Colors.CYAN}{Colors.BOLD}========================================================================================
  [R4U] Ruppee4U Enterprise Loan Application ERP — Master Runner
========================================================================================{Colors.ENDC}
  {Colors.GREEN}[*]{Colors.ENDC} Backend Engine   : {Colors.BOLD}Python FastAPI{Colors.ENDC} (Port 5000)
  {Colors.GREEN}[*]{Colors.ENDC} Frontend Client  : {Colors.BOLD}React + Vite + TailwindCSS{Colors.ENDC} (Port 5173)
  {Colors.GREEN}[*]{Colors.ENDC} Segmented CSVs   : {Colors.BOLD}./csv_data/{Colors.ENDC} (personal, document, digital, master)
  {Colors.GREEN}[*]{Colors.ENDC} Application Data : {Colors.BOLD}./data/{Colors.ENDC}
{Colors.CYAN}========================================================================================{Colors.ENDC}
"""
    print(banner, flush=True)

def is_port_in_use(port, host='127.0.0.1'):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0

def wait_for_port(port, host='127.0.0.1', timeout=15):
    start_time = time.time()
    while time.time() - start_time < timeout:
        if is_port_in_use(port, host):
            return True
        time.sleep(0.3)
    return False

def quick_resync_all_datasets():
    """Quickly regenerates and synchronizes all datasets and CSV archives."""
    print(colorize("\n[Auto-Sync] Re-synchronizing all CSV datasets and application records...", Colors.CYAN), flush=True)
    try:
        import database
        import server

        # Ensure database tables and initial seeds exist
        database.init_db()

        # Sync ./csv_data/ (personal, document, digital, master)
        server.sync_all_datasets_to_csv_data_folder()

        # Sync ./data/ (individual application CSVs and master)
        server.sync_all_applications_to_data_folder()

        csv_data_dir = os.path.abspath("./csv_data")
        data_dir = os.path.abspath("./data")

        files_csv_data = [f for f in os.listdir(csv_data_dir) if f.endswith(".csv")] if os.path.exists(csv_data_dir) else []
        files_data = [f for f in os.listdir(data_dir) if f.endswith(".csv")] if os.path.exists(data_dir) else []

        print(f"  * Categorized Datasets in {colorize('./csv_data/', Colors.BOLD)} ({len(files_csv_data)} files) {colorize('[OK]', Colors.GREEN)}", flush=True)
        for f in sorted(files_csv_data):
            fpath = os.path.join(csv_data_dir, f)
            size_kb = os.path.getsize(fpath) / 1024.0
            print(f"      -> {f:<30} ({size_kb:.1f} KB)", flush=True)

        print(f"  * Application Archives in {colorize('./data/', Colors.BOLD)} ({len(files_data)} files) {colorize('[OK]', Colors.GREEN)}", flush=True)
        return True
    except Exception as e:
        print(colorize(f"  [X] Auto-sync encountered an error: {e}", Colors.FAIL), flush=True)
        return False

def check_requirements():
    print(colorize("[1/3] Checking system environment...", Colors.CYAN), flush=True)
    
    # Check Python version
    py_ver = sys.version_info
    print(f"  * Python {py_ver.major}.{py_ver.minor}.{py_ver.micro} detected {colorize('[OK]', Colors.GREEN)}", flush=True)

    # Check Node.js
    node_bin = shutil.which("node")
    npm_bin = shutil.which("npm")
    if not node_bin or not npm_bin:
        print(colorize("  [X] Node.js or npm not found in PATH. Please install Node.js (v18+) to run the frontend.", Colors.FAIL), flush=True)
        sys.exit(1)
    print(f"  * Node.js & npm detected {colorize('[OK]', Colors.GREEN)}", flush=True)

    # Check node_modules
    root_dir = os.path.dirname(os.path.abspath(__file__))
    node_modules_dir = os.path.join(root_dir, "node_modules")
    if not os.path.exists(node_modules_dir):
        print(colorize("  * node_modules not found. Running 'npm install'...", Colors.WARNING), flush=True)
        try:
            subprocess.run(["npm", "install"], cwd=root_dir, check=True, shell=(sys.platform == 'win32'))
            print(colorize("  * npm dependencies installed successfully [OK]", Colors.GREEN), flush=True)
        except Exception as e:
            print(colorize(f"  [X] Failed to run 'npm install': {e}", Colors.FAIL), flush=True)
            sys.exit(1)
    else:
        print(f"  * Frontend dependencies installed {colorize('[OK]', Colors.GREEN)}", flush=True)

def stream_logs(process, prefix, color):
    try:
        for line in iter(process.stdout.readline, ''):
            if not line:
                break
            line_str = line.strip()
            if line_str:
                print(f"{color}[{prefix}]{Colors.ENDC} {line_str}", flush=True)
    except Exception:
        pass

def kill_process_tree(pid):
    if sys.platform == 'win32':
        try:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:
            pass

def main():
    parser = argparse.ArgumentParser(description="Run the full Loan Application ERP project with automatic dataset syncing.")
    parser.add_argument("--sync-only", action="store_true", help="Quick re-sync all CSV datasets and application records, then exit.")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open the web browser on startup.")
    parser.add_argument("--backend-port", type=int, default=5000, help="Port for the FastAPI backend server (default: 5000).")
    parser.add_argument("--frontend-port", type=int, default=5173, help="Port for the Vite frontend server (default: 5173).")
    args = parser.parse_args()

    root_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root_dir)

    print_banner()

    # If --sync-only flag is passed, just do the quick resync and exit
    if args.sync_only:
        quick_resync_all_datasets()
        print(colorize("\n[OK] Quick dataset and CSV re-sync completed successfully.\n", Colors.GREEN), flush=True)
        return

    # 1. Environment requirements check
    check_requirements()

    # 2. Automatic Quick Re-Sync of datasets and CSV files
    quick_resync_all_datasets()

    print(colorize("\n[2/3] Launching background servers...", Colors.CYAN), flush=True)

    # Check if ports are already busy
    if is_port_in_use(args.backend_port):
        print(colorize(f"  [i] Port {args.backend_port} is already active. FastAPI backend is running.", Colors.GREEN), flush=True)
        backend_process = None
    else:
        print(f"  * Starting Python FastAPI Backend on http://localhost:{args.backend_port}...", flush=True)
        backend_cmd = [sys.executable, "server.py"]
        backend_process = subprocess.Popen(
            backend_cmd,
            cwd=root_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0
        )
        threading.Thread(target=stream_logs, args=(backend_process, "BACKEND", Colors.BLUE), daemon=True).start()

    # Start Vite Frontend
    if is_port_in_use(args.frontend_port):
        print(colorize(f"  [i] Port {args.frontend_port} is already active. Vite frontend is running.", Colors.GREEN), flush=True)
        frontend_process = None
    else:
        print(f"  * Starting Vite React Frontend on http://localhost:{args.frontend_port}...", flush=True)
        frontend_cmd = ["npm", "run", "client"]
        frontend_process = subprocess.Popen(
            frontend_cmd,
            cwd=root_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            shell=(sys.platform == 'win32'),
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0
        )
        threading.Thread(target=stream_logs, args=(frontend_process, "FRONTEND", Colors.GREEN), daemon=True).start()

    # Wait for services to become responsive
    print(colorize("\n[3/3] Verifying server health...", Colors.CYAN), flush=True)
    
    backend_ok = wait_for_port(args.backend_port, timeout=12)
    frontend_ok = wait_for_port(args.frontend_port, timeout=15)

    if backend_ok:
        print(f"  {Colors.GREEN}[OK]{Colors.ENDC} FastAPI Backend ready: {Colors.BOLD}http://localhost:{args.backend_port}{Colors.ENDC}", flush=True)
        print(f"       - Swagger Documentation: {Colors.CYAN}http://localhost:{args.backend_port}/docs{Colors.ENDC}", flush=True)
        print(f"       - Datasets API:          {Colors.CYAN}http://localhost:{args.backend_port}/api/datasets/info{Colors.ENDC}", flush=True)
    else:
        print(colorize(f"  [!] Backend did not respond on port {args.backend_port} within timeout.", Colors.WARNING), flush=True)

    if frontend_ok:
        print(f"  {Colors.GREEN}[OK]{Colors.ENDC} Vite Frontend ready:    {Colors.BOLD}http://localhost:{args.frontend_port}{Colors.ENDC}", flush=True)
    else:
        print(colorize(f"  [!] Frontend did not respond on port {args.frontend_port} within timeout.", Colors.WARNING), flush=True)

    ready_url = f"http://localhost:{args.frontend_port}"
    print(f"\n{Colors.GREEN}{Colors.BOLD}[SUCCESS] ALL SERVICES ONLINE & OPERATIONAL!{Colors.ENDC}", flush=True)
    print(f">>> Open your browser at: {Colors.BOLD}{Colors.CYAN}{ready_url}{Colors.ENDC}\n", flush=True)
    print(colorize("Available Login Roles:", Colors.BOLD), flush=True)
    print("  [Bank Officer] : bank_officer / bank123", flush=True)
    print("  [Customer]     : customer_rajesh / cust123", flush=True)
    print("  [Developer]    : developer / dev123\n", flush=True)
    print(colorize("Press Ctrl+C anytime to stop all servers gracefully.\n", Colors.DIM), flush=True)

    if not args.no_browser and frontend_ok:
        try:
            webbrowser.open(ready_url)
        except Exception:
            pass

    # Keep main thread alive and handle clean shutdown
    try:
        while True:
            time.sleep(1)
            # Check if backend or frontend died unexpectedly
            if backend_process and backend_process.poll() is not None:
                print(colorize("\n[!] Backend process terminated unexpectedly.", Colors.FAIL), flush=True)
                break
            if frontend_process and frontend_process.poll() is not None:
                print(colorize("\n[!] Frontend process terminated unexpectedly.", Colors.FAIL), flush=True)
                break
    except KeyboardInterrupt:
        print(colorize("\n\nShutting down all servers gracefully...", Colors.WARNING), flush=True)
    finally:
        if backend_process and backend_process.poll() is None:
            print("  * Stopping FastAPI backend...", flush=True)
            kill_process_tree(backend_process.pid)
        if frontend_process and frontend_process.poll() is None:
            print("  * Stopping Vite frontend...", flush=True)
            kill_process_tree(frontend_process.pid)
        print(colorize("[OK] All services stopped cleanly. Goodbye!\n", Colors.GREEN), flush=True)

if __name__ == "__main__":
    main()
