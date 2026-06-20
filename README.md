# Here are your Instructions

## Backend Load Testing

A new backend load-testing script is available at `backend/load_test.py`.

Run it from the repo root:

```bash
cd backend
pip install -r requirements.txt
python load_test.py --base-url http://localhost:8000 --duration 60 --http-workers 10 --ws-workers 5
```

Options:
- `--email`, `--password`: login credentials for the test user
- `--http-workers`: number of concurrent HTTP clients
- `--ws-workers`: number of WebSocket clients to open
- `--duration`: length of the test in seconds
- `--http-delay`: delay between HTTP requests per worker in ms
