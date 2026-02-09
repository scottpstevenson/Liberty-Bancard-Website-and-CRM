import { z } from 'zod';
import { insertContactSchema, contacts, insertTicketSchema, tickets } from './schema';

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
    list: {
      method: 'GET' as const,
      path: '/api/contacts' as const,
      responses: {
        200: z.array(z.custom<typeof contacts.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/contacts' as const,
      input: insertContactSchema,
      responses: {
        201: z.custom<typeof contacts.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/contacts/:id' as const,
      responses: {
        200: z.custom<typeof contacts.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/contacts/:id' as const,
      input: insertContactSchema.partial(),
      responses: {
        200: z.custom<typeof contacts.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  tickets: {
    list: {
      method: 'GET' as const,
      path: '/api/tickets' as const,
      responses: {
        200: z.array(z.custom<typeof tickets.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/tickets' as const,
      input: insertTicketSchema,
      responses: {
        201: z.custom<typeof tickets.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/tickets/:id' as const,
      input: insertTicketSchema.partial(),
      responses: {
        200: z.custom<typeof tickets.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
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
