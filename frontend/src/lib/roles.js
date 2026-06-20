/** Role identifiers — must match backend policies.py exactly. */
export const ROLES = {
  OWNER:        'owner',
  MANAGER:      'restaurant_manager',
  ROOM_MANAGER: 'room_manager',
  SERVER:       'server',
  BARTENDER:    'bartender',
  KITCHEN:      'kitchen_staff',
  CASHIER:      'cashier',

  // Legacy aliases
  SUPER_ADMIN:  'owner',
  BRANCH_ADMIN: 'restaurant_manager',
  INVENTORY:    'restaurant_manager',
};

// ── Permission helpers (mirror the backend matrix) ────────────────────────

/** Full revenue reports and analytics */
export const canViewReports = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Room revenue report (room manager can see their room revenue) */
export const canViewRoomRevenue = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER].includes(role);

/** View floor plan / room status */
export const canViewFloor = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER].includes(role);

/** Create / edit / delete rooms */
export const canManageRooms = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Create / edit reservations — CHANGE: room manager added, server removed */
export const canManageReservations = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER].includes(role);

/** View reservations (read-only for FOH) */
export const canViewReservations = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.CASHIER].includes(role);

/** Place new orders — CHANGE: room_manager added */
export const canTakeOrders = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.CASHIER].includes(role);

/** Void / cancel orders — managers only */
export const canVoidOrders = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Collect payment / apply discount */
export const canProcessPayment = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER].includes(role);

/** Kitchen Display System — CHANGE: bartender removed */
export const canViewKitchen = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.KITCHEN].includes(role);

/** Bar Display — CHANGE: kitchen staff removed */
export const canViewBar = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.BARTENDER].includes(role);

/** Mark items ready on KDS / bar */
export const canUpdateItemStatus = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.KITCHEN, ROLES.BARTENDER].includes(role);

/** 86 a menu item */
export const can86Item = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.KITCHEN, ROLES.BARTENDER].includes(role);

/** Create / edit menu items */
export const canManageMenu = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Log waste / spillage — CHANGE: kitchen + bartender only (not server) */
export const canLogWaste = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.BARTENDER, ROLES.KITCHEN].includes(role);

/** Manage ingredients / inventory */
export const canManageInventory = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Create / deactivate staff */
export const canManageEmployees = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Shift management */
export const canViewAllShifts = (role) =>
  [ROLES.OWNER, ROLES.MANAGER, ROLES.CASHIER].includes(role);

/** Audit log */
export const canViewAuditLog = (role) =>
  [ROLES.OWNER, ROLES.MANAGER].includes(role);

/** Branch management */
export const canManageBranches = (role) => role === ROLES.OWNER;

/** Roles an admin can create */
export const creatableEmployeeRoles = (creatorRole) => {
  if (creatorRole === ROLES.OWNER) {
    return [ROLES.MANAGER, ROLES.ROOM_MANAGER, ROLES.SERVER,
            ROLES.BARTENDER, ROLES.KITCHEN, ROLES.CASHIER];
  }
  if (creatorRole === ROLES.MANAGER) {
    return [ROLES.ROOM_MANAGER, ROLES.SERVER, ROLES.BARTENDER, ROLES.KITCHEN, ROLES.CASHIER];
  }
  return [];
};

export const ROLE_LABELS = {
  [ROLES.OWNER]:        'Owner',
  [ROLES.MANAGER]:      'Restaurant Manager',
  [ROLES.ROOM_MANAGER]: 'Room Manager',
  [ROLES.SERVER]:       'Server',
  [ROLES.BARTENDER]:    'Bartender',
  [ROLES.KITCHEN]:      'Kitchen Staff',
  [ROLES.CASHIER]:      'Cashier',
};
