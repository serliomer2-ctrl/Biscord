'use strict';

// Sunucu izinleri (bit alanı). İstemci aynı değerleri /api/config üzerinden alır.
const P = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  KICK_MEMBERS: 1 << 4,
  BAN_MEMBERS: 1 << 5,
  MANAGE_MESSAGES: 1 << 6,
  SEND_MESSAGES: 1 << 7,
  ATTACH_FILES: 1 << 8,
  ADD_REACTIONS: 1 << 9,
  MENTION_EVERYONE: 1 << 10,
  CREATE_INVITE: 1 << 11,
  CONNECT: 1 << 12,
  SPEAK: 1 << 13,
  VIDEO: 1 << 14,
  MUTE_MEMBERS: 1 << 15,
  CHANGE_NICKNAME: 1 << 16,
  MOVE_MEMBERS: 1 << 17,
};

const ALL_PERMS = (1 << 18) - 1;

const DEFAULT_PERMS =
  P.SEND_MESSAGES | P.ATTACH_FILES | P.ADD_REACTIONS | P.CREATE_INVITE |
  P.CONNECT | P.SPEAK | P.VIDEO | P.CHANGE_NICKNAME;

module.exports = { P, ALL_PERMS, DEFAULT_PERMS };
