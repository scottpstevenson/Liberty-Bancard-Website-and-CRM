import { z } from 'zod';
import { insertContactSchema, insertDealSchema, insertTicketSchema, insertTaskSchema, insertCompanySchema, insertDocumentSchema, insertNotificationSchema, insertAuditLogSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  contacts: {
    list: { method: 'GET' as const, path: '/api/contacts' as const },
    create: { method: 'POST' as const, path: '/api/contacts' as const, input: insertContactSchema },
    get: { method: 'GET' as const, path: '/api/contacts/:id' as const },
    update: { method: 'PUT' as const, path: '/api/contacts/:id' as const, input: insertContactSchema.partial() },
  },
  companies: {
    list: { method: 'GET' as const, path: '/api/companies' as const },
    create: { method: 'POST' as const, path: '/api/companies' as const, input: insertCompanySchema },
    get: { method: 'GET' as const, path: '/api/companies/:id' as const },
  },
  deals: {
    list: { method: 'GET' as const, path: '/api/deals' as const },
    create: { method: 'POST' as const, path: '/api/deals' as const, input: insertDealSchema },
    get: { method: 'GET' as const, path: '/api/deals/:id' as const },
    update: { method: 'PUT' as const, path: '/api/deals/:id' as const, input: insertDealSchema.partial() },
  },
  tickets: {
    list: { method: 'GET' as const, path: '/api/tickets' as const },
    create: { method: 'POST' as const, path: '/api/tickets' as const, input: insertTicketSchema },
    get: { method: 'GET' as const, path: '/api/tickets/:id' as const },
    update: { method: 'PUT' as const, path: '/api/tickets/:id' as const, input: insertTicketSchema.partial() },
  },
  tasks: {
    list: { method: 'GET' as const, path: '/api/tasks' as const },
    create: { method: 'POST' as const, path: '/api/tasks' as const, input: insertTaskSchema },
    update: { method: 'PUT' as const, path: '/api/tasks/:id' as const, input: insertTaskSchema.partial() },
  },
  documents: {
    list: { method: 'GET' as const, path: '/api/documents' as const },
    create: { method: 'POST' as const, path: '/api/documents' as const, input: insertDocumentSchema },
  },
  notifications: {
    list: { method: 'GET' as const, path: '/api/notifications' as const },
    create: { method: 'POST' as const, path: '/api/notifications' as const, input: insertNotificationSchema },
    markRead: { method: 'PUT' as const, path: '/api/notifications/:id/read' as const },
  },
  auditLogs: {
    list: { method: 'GET' as const, path: '/api/audit-logs' as const },
  },
  ai: {
    chat: { method: 'POST' as const, path: '/api/ai/chat' as const },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
