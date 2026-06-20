# Bar & Restaurant Management System — Deployment Guide

## Quick Start (Local Development)

```bash
# Backend (from project root)
python -m uvicorn backend.pg_server:app --host 0.0.0.0 --port 8000 --reload

# Frontend (from frontend/ directory)
npm start
```

---

## Production Deployment

### 1. Set Environment Variables

Edit `backend/.env`:
```
DATABASE_URL="postgresql+asyncpg://postgres:YOUR_DB_PASS@localhost:5432/bar_restaurant_ethiopia"
JWT_SECRET="<generate: python -c 'import secrets; print(secrets.token_hex(64))'>"
APP_ENV=production
FRONTEND_URL="http://YOUR_SERVER_IP_OR_DOMAIN"
```

### 2. Build the Frontend

```bash
cd frontend
# Set production API URL
echo "REACT_APP_BACKEND_URL=http://YOUR_SERVER_IP:8000" > .env.production
npm run build
# Output is in frontend/build/
```

### 3. Run Backend Without --reload

```bash
# Option A: Direct uvicorn (production)
python -m uvicorn backend.pg_server:app --host 0.0.0.0 --port 8000 --workers 1

# Option B: via run.py (respects APP_ENV)
python backend/run.py

# Option C: Docker Compose
docker-compose up -d
```

> ⚠️ NEVER use `--reload` in production. It doubles memory usage and reloads on any file change.

### 4. Serve Frontend with Nginx

Copy `nginx.conf` to `/etc/nginx/sites-available/brms` and symlink:
```bash
sudo ln -s /etc/nginx/sites-available/brms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Or use Docker Compose which includes nginx automatically.

### 5. HTTPS with Let's Encrypt (Recommended)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```
Then uncomment the HTTPS block in `nginx.conf`.

---

## Database Backup Strategy

### Automated Daily Backup (Linux cron)

```bash
# Add to crontab: crontab -e
0 2 * * * pg_dump -U postgres bar_restaurant_ethiopia | gzip > /backups/brms_$(date +\%Y\%m\%d).sql.gz
# Keep last 30 days
find /backups -name "brms_*.sql.gz" -mtime +30 -delete
```

### Manual Backup
```bash
pg_dump -U postgres bar_restaurant_ethiopia > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore from Backup
```bash
psql -U postgres bar_restaurant_ethiopia < backup_file.sql
```

---

## Security Checklist Before Going Live

- [ ] Change `ADMIN_PASSWORD` in `backend/.env`
- [ ] Force all staff to change passwords on first login (already set)
- [ ] Set `APP_ENV=production` in backend `.env`
- [ ] Use a strong `JWT_SECRET` (64+ hex chars — already updated)
- [ ] Set `FRONTEND_URL` to your actual domain (not localhost)
- [ ] Enable HTTPS / SSL certificate
- [ ] Run `npm run build` for frontend production build
- [ ] Never run backend with `--reload` flag in production
- [ ] Set up automated PostgreSQL backups
- [ ] Restrict database port 5432 to localhost only (firewall)

---

## Role Defaults

| Role | Default Password | Force Change |
|------|-----------------|--------------|
| owner | set at setup | no |
| restaurant_manager | `Welcome1!` | yes (on first login) |
| room_manager | `Welcome1!` | yes |
| server | `Welcome1!` | yes |
| bartender | `Welcome1!` | yes |
| kitchen_staff | `Welcome1!` | yes |
| cashier | `Welcome1!` | yes |
