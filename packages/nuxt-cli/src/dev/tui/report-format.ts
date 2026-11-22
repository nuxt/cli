import type { DevReportSummary } from '../error-channel'

let renderAnsi: typeof import('my-bad').renderAnsi | undefined

/**
 * Lay a report out for `columns`. Its own rendering stands in until `my-bad`
 * has loaded, and for a summary that arrived without its report.
 */
export function formatReport(summary: DevReportSummary): (columns: number) => string {
  const report = summary.report
  if (!report) {
    return () => summary.ansi
  }
  if (!renderAnsi) {
    void import('my-bad').then((module) => {
      renderAnsi = module.renderAnsi
    }).catch(() => {})
  }
  let last: { columns: number, text: string } | undefined
  return (columns) => {
    if (!renderAnsi) {
      return summary.ansi
    }
    if (last?.columns !== columns) {
      last = {
        columns,
        text: renderAnsi(report, { cwd: summary.cwd, width: columns }),
      }
    }
    return last.text
  }
}
