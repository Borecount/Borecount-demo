import { useState } from 'react';

// Keep the chosen reporting window when navigating between workspace sections.
export function useReportWindow() {
  const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString());
  const [reportAsOf, setReportAsOf] = useState(new Date().toISOString());
  const reportQuery = { from: reportFrom, as_of: reportAsOf, limit: 25 };
  return {
    reportFrom,
    setReportFrom,
    reportAsOf,
    setReportAsOf,
    reportQuery,
  };
}
export type ReportWindow = ReturnType<typeof useReportWindow>;
