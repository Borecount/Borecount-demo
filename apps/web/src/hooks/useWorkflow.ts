import { useEffect, useState } from 'react';
import { toLibraryCall, toRestRequest, type DemoMode, type DemoRequest } from '../api';
import { operations, type Area, type Context, type Operation } from '../operations';
import { errorMessage, formatJson, newReference } from '../workspace-utils';
import type { Sandbox } from './useSandbox';
export function useWorkflow(mode: DemoMode, sandbox: Sandbox) {
  const { session, ledger, currency, accounts, ids, expirationAsOf, execute, setError, setIds } =
    sandbox;
  const [area, setArea] = useState<Area>('Accounts');
  const [libraryDraft, setLibraryDraft] = useState('{}');
  const [preset, setPreset] = useState<Operation | null>(null);
  const [draftPath, setDraftPath] = useState('/v1/transactions');
  const [draftMethod, setDraftMethod] = useState<'GET' | 'POST'>('POST');
  const [draftBody, setDraftBody] = useState('{}');
  const [scenario, setScenario] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const context: Context = {
    actor: session?.actor_id ?? '',
    ledger,
    currency,
    accounts,
    ...ids,
    expirationAsOf,
  };
  const selectReconciliationId = (key: 'upload' | 'rule' | 'run', id: string) => {
    setIds((old) => ({ ...old, [key]: id }));
    setPreset(null);
  };
  const choose = (operation: Operation) => {
    const draft = operation.build(context, newReference());
    setPreset(operation);
    setDraftPath(draft.path);
    setDraftMethod(draft.method);
    setDraftBody(formatJson(draft.body ?? {}));
    setLibraryDraft(formatJson(toLibraryCall(draft).input));
  };
  const switchArea = (next: Area) => {
    setArea(next);
    setPreset(null);
  };
  const openOperation = (id: string) => {
    const operation = operations.find((candidate) => candidate.id === id)!;
    setArea(operation.area);
    choose(operation);
  };
  const submitDraft = async () => {
    try {
      if (mode === 'library') {
        const call = toLibraryCall({ method: draftMethod, path: draftPath });
        call.input = JSON.parse(libraryDraft);
        await execute({ ...toRestRequest(call), libraryCall: call });
        return;
      }
      const body = draftMethod === 'POST' && draftBody.trim() ? JSON.parse(draftBody) : undefined;
      if (body !== undefined && (body === null || Array.isArray(body) || typeof body !== 'object'))
        throw new Error('Request body must be a JSON object');
      await execute({ method: draftMethod, path: draftPath, ...(body ? { body } : {}) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const translateDraft = (next: DemoMode) => {
    // Translate the existing draft to preserve edited amounts and references.
    if (preset) {
      try {
        if (next === 'library') {
          const currentRequest: DemoRequest = { method: draftMethod, path: draftPath };
          if (draftMethod === 'POST') {
            currentRequest.body = JSON.parse(draftBody);
          }
          const libraryCall = toLibraryCall(currentRequest);
          setLibraryDraft(formatJson(libraryCall.input));
        } else {
          const libraryMethod = toLibraryCall({ method: draftMethod, path: draftPath }).operation;
          const operation = toRestRequest({
            operation: libraryMethod,
            input: JSON.parse(libraryDraft),
          });
          if (operation.path.startsWith('/v1/adjustments/')) {
            operation.body = { ...operation.body, actor_id: session?.actor_id ?? '' };
          }
          setDraftMethod(operation.method);
          setDraftPath(operation.path);
          setDraftBody(formatJson(operation.body ?? {}));
        }
      } catch (cause) {
        throw new Error(`Fix the current draft before switching modes: ${errorMessage(cause)}`, {
          cause,
        });
      }
    }
  };
  useEffect(() => {
    setPreset(null);
  }, [ledger, session?.tenant_id]);
  useEffect(() => {
    setScenario(null);
  }, [session?.tenant_id]);
  return {
    area,
    switchArea,
    preset,
    choose,
    draftMethod,
    setDraftMethod,
    draftPath,
    setDraftPath,
    draftBody,
    setDraftBody,
    libraryDraft,
    setLibraryDraft,
    scenario,
    setScenario,
    step,
    setStep,
    openOperation,
    submitDraft,
    translateDraft,
    selectReconciliationId,
  };
}
export type Workflow = ReturnType<typeof useWorkflow>;
