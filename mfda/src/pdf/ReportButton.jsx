import { PDFDownloadLink } from '@react-pdf/renderer';
import ReportDocument from './ReportDocument';
import { useTenantCompletionGuard } from '../lib/tenant-query';

export default function ReportButton({ deal, scenario, agent }) {
  const isCurrent = useTenantCompletionGuard()();
  const name = `${(deal.address || 'deal').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-report.pdf`;
  return (
    <PDFDownloadLink
      document={<ReportDocument deal={deal} scenario={scenario} agent={agent} />}
      fileName={name}
      className="btn-primary"
      onClickCapture={(event) => {
        if (!isCurrent()) { event.preventDefault(); event.stopPropagation(); }
      }}
    >
      {({ loading }) => (loading ? 'Building PDF…' : 'PDF report')}
    </PDFDownloadLink>
  );
}
