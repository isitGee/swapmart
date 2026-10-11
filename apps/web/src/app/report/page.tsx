import Link from 'next/link';
import { REPORT_CATEGORIES } from '@swapmart/shared';
import { Alert, DisclaimerNote, PageHeader, Panel } from '@/components/ui/feedback';
import { Icon } from '@/components/ui/icon';
import { getCurrentUser } from '@/lib/server-api';
import { ReportForm } from './report-form';
import { humanize } from '@/lib/format';

export const metadata = { title: 'Report a listing' };

export default async function ReportPage() {
  const user = await getCurrentUser();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="Trust & safety"
        title="Report a listing, message or member"
        description="Reports go to the administrator review queue with a reference number you can follow. Reports and their resolutions are retained — nothing is silently deleted."
      />

      {!user ? (
        <Alert
          tone="warning"
          className="mt-6"
          title="Sign in to file a report"
          action={
            <Link href="/signin?next=/report" className="text-sm font-medium text-brand-700 underline">
              Sign in
            </Link>
          }
        >
          Reports must be attributable so that administrators can ask follow-up questions and so that unfounded reports can
          be identified. Your report is not shown to the member you are reporting.
        </Alert>
      ) : (
        <div className="mt-6">
          <ReportForm />
        </div>
      )}

      <Panel title="What happens next" className="mt-8">
        <ol className="space-y-3 text-sm text-ink-600">
          {[
            'Your report is stored with a reference such as RPT-2026-000123 and placed in the open queue.',
            'An administrator reads the report, inspects the listing or conversation record, and may request evidence.',
            'The status moves through under investigation, possibly escalated, and finally resolved or dismissed — always with a written resolution.',
            'You are notified each time the status changes and can follow it from your dashboard.',
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Categories you can choose from" className="mt-6">
        <ul className="grid gap-2 sm:grid-cols-2">
          {REPORT_CATEGORIES.map((category) => (
            <li key={category} className="flex items-center gap-2 text-sm text-ink-600">
              <Icon name="flag" size={14} className="text-ink-400" />
              {humanize(category)}
            </li>
          ))}
        </ul>
        <DisclaimerNote className="mt-4">
          Reporting a device as stolen does not itself change any listing. An administrator reviews the evidence before any
          action is taken against a member.
        </DisclaimerNote>
      </Panel>
    </div>
  );
}
