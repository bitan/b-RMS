# Supermarket Management System - PRD

## Problem Statement
Build a full-featured supermarket management system with role-based access control.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver)
- **Frontend**: React + Tailwind CSS + Shadcn UI + Recharts
- **Auth**: JWT tokens (httpOnly cookies), bcrypt password hashing
- **Database**: MongoDB with collections: users, products, categories, suppliers, sales, login_attempts

## User Personas & Roles
| Role | Account | Password | Permitted Pages | Default Landing |
|------|---------|----------|----------------|-----------------|
| Branch Admin | admin@supermarket.com | admin123 | Dashboard, POS, Inventory, Suppliers, Employees, Reports | Dashboard (/) |
| Cashier | cashier@supermarket.com | cashier123 | Dashboard, Point of Sale | POS (/pos) |
| Store Keeper | storekeeper@supermarket.com | store123 | Dashboard, Inventory, Suppliers | Inventory (/inventory) |

## Core Requirements
- JWT authentication with role-based access control
- Product/Inventory CRUD with low stock alerts
- POS billing with cart, checkout, payment methods
- Supplier management CRUD
- Employee management (admin only)
- Sales reports with charts (revenue trends, top products, category breakdown)
- Role-based navigation and routing

## What's Been Implemented (2026-02-05)
- Full JWT auth (login, register, logout, refresh, me, brute force protection)
- Admin seeding on startup
- Product CRUD with search, category filter, low stock alerts
- Category management with defaults
- Supplier CRUD with card-based UI
- Employee management (admin-only)
- POS with product grid, cart, checkout, success dialog
- Sales recording with stock deduction
- Dashboard with role-based stat cards and charts
- Reports page with revenue trends, daily orders, category pie chart, top products
- Role-based routing (each role redirects to their landing page)
- Swiss/High-Contrast design with Chivo + IBM Plex Sans fonts
- **Discount engine** with promo codes (WELCOME10, SAVE5, SUPER20), percentage and fixed discounts
- **Product expiry date tracking** with color-coded alerts in inventory table
- **Shift management** (start/end shifts, end-of-day sales reconciliation report)
- **Audit log** (tracks all system actions: sales, shifts, user registrations, promo creations)
- **Locked register endpoint** (only admin can create admin/inventory_manager accounts)
- **Real-time stock sync** via WebSocket (POS auto-refreshes when stock changes)

## Prioritized Backlog
### P0 (Done)
- Auth, CRUD for all entities, POS, Reports, Role-based routing

### P1
- Barcode scanning integration
- Receipt printing
- Product image upload
- Bulk product import/export (CSV)

### P2
- Advanced discount management (percentage, coupons)
- Inventory audit log
- Supplier order management
- Employee shift scheduling
- Email notifications for low stock
