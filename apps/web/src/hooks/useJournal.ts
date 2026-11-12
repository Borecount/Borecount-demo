import { useEffect, useState } from 'react';
import { observeRequests, type RequestRecord } from '../api';
export function useJournal(tenantId?: string) {
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [recordId, setRecordId] = useState<number | null>(null);
  useEffect(
    () =>
      observeRequests((record) => {
        setRecords((old) => [record, ...old].slice(0, 150));
        if (record.foreground) setRecordId(record.id);
      }),
    [],
  );

  useEffect(() => {
    setRecordId(null);
  }, [tenantId]);
  return {
    records,
    selectedRecord: records.find((record) => record.id === recordId) ?? records[0],
    select: setRecordId,
  };
}
