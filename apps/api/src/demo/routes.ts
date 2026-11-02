import type { FastifyInstance, FastifyReply } from 'fastify';
import { holdFilterFields, invalidWhereError, readWhereParameter } from '@borecount/http';
import { listHoldsQuerySchema, type ListHoldsQuery } from '@borecount/http/contracts';
import { DemoInputError, DemoNotReadyError, type DemoService, type DemoStateQuery } from './demo-service';

const { ledger_id: _ledgerId, ...stateHoldFilterFields } = holdFilterFields;

const handleError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof DemoInputError || error instanceof DemoNotReadyError) {
    return reply.status(error.statusCode).send({ error: error.name, message: error.message });
  }
  throw error;
};

export const registerDemoRoutes = (
  server: FastifyInstance,
  demo: DemoService,
  options: { resetEnabled: boolean },
): void => {
  server.get<{ Querystring: ListHoldsQuery }>('/demo/state', {
    schema: { querystring: listHoldsQuerySchema },
  }, async (request, reply) => {
    try {
      const where = readWhereParameter<DemoStateQuery['where']>(request.raw.url ?? '', stateHoldFilterFields);
      if (where === null) throw invalidWhereError();
      return await demo.getState({ limit: request.query.limit, cursor: request.query.cursor, where });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  server.get<{ Params: { address: string } }>('/demo/accounts/:address/details',
    { schema: { params: { type: 'object', required: ['address'], properties: {
      address: { type: 'string', minLength: 1, maxLength: 80 },
    } } } }, async (request, reply) => {
      try { return await demo.getAccountDetails(request.params.address); }
      catch (error) { return handleError(reply, error); }
    });

  server.post<{ Body: { address: string } }>(
    '/demo/accounts',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['address'],
          properties: { address: { type: 'string', minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (request, reply) => {
      try {
        return await demo.createAccount(request.body.address);
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  server.post<{ Params: { address: string }; Body: { amount_minor: string } }>(
    '/demo/accounts/:address/fund',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['amount_minor'],
          properties: { amount_minor: { type: 'string', pattern: '^[1-9][0-9]*$' } },
        },
      },
    },
    async (request, reply) => {
      try {
        return await demo.fund(request.params.address, request.body.amount_minor);
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  server.post<{ Body: { from: string; to: string; amount_minor: string } }>(
    '/demo/transfers',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to', 'amount_minor'],
          properties: {
            from: { type: 'string', minLength: 1, maxLength: 80 },
            to: { type: 'string', minLength: 1, maxLength: 80 },
            amount_minor: { type: 'string', pattern: '^[1-9][0-9]*$' },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return await demo.transfer(request.body.from, request.body.to, request.body.amount_minor);
      } catch (error) {
        return handleError(reply, error);
      }
    },
  );

  const transferBody = { type: 'object', additionalProperties: false,
    required: ['from', 'to', 'amount_minor'], properties: {
      from: { type: 'string', minLength: 1, maxLength: 80 },
      to: { type: 'string', minLength: 1, maxLength: 80 },
      amount_minor: { type: 'string', pattern: '^[1-9][0-9]*$' },
    } };
  server.post<{ Body: { from: string; to: string; amount_minor: string } }>(
    '/demo/holds', { schema: { body: transferBody } }, async (request, reply) => {
      try { return await demo.createHold(request.body.from, request.body.to, request.body.amount_minor); }
      catch (error) { return handleError(reply, error); }
    });
  for (const action of ['commit', 'void'] as const) {
    server.post<{ Params: { id: string } }>(`/demo/holds/:id/${action}`,
      { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } },
      async (request, reply) => {
        try { return await demo.resolveHold(request.params.id, action); }
        catch (error) { return handleError(reply, error); }
      });
  }
  server.post<{ Body: { reference: string; amount_minor: string } }>('/demo/reconciliation',
    { schema: { body: { type: 'object', additionalProperties: false, required: ['reference', 'amount_minor'],
      properties: { reference: { type: 'string', minLength: 1, maxLength: 255 },
        amount_minor: { type: 'string', pattern: '^[1-9][0-9]*$' } } } } }, async (request, reply) => {
      try { return await demo.reconcile(request.body.reference, request.body.amount_minor); }
      catch (error) { return handleError(reply, error); }
    });

  server.post('/demo/reset', async (_request, reply) => {
    if (!options.resetEnabled) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
    }
    return demo.reset();
  });
};
