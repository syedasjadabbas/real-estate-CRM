import Link from "next/link";
import { LetterTile } from "@/components/ui/avatar";
import { Badge, StatusTag } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import type { RecentLead } from "../types";

export function RecentLeads({ leads }: { leads: RecentLead[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Recent leads"
        badge={<Badge bordered={false}>{leads.length} shown</Badge>}
        description="Latest registrations in your lead scope"
        actions={
          <Link href="/dashboard/leads" className={buttonClasses({ variant: "soft", size: "sm" })}>
            View all →
          </Link>
        }
      />
      {leads.length === 0 ? (
        <div className="p-4">
          <EmptyState>No leads to show yet.</EmptyState>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Status</TH>
              <TH>Inbound</TH>
              <TH>Owner</TH>
              <TH align="right">Created</TH>
            </TR>
          </THead>
          <TBody>
            {leads.map((lead) => (
              <TR key={lead.id}>
                <TD>
                  <span className="flex items-center gap-2.5">
                    <LetterTile name={lead.name} />
                    <Link href={`/dashboard/leads/${lead.id}`} className="font-bold hover:text-brand hover:underline">
                      {lead.name}
                    </Link>
                  </span>
                </TD>
                <TD>
                  {/* The reference renders every stage as a neutral chip on this widget. */}
                  <StatusTag>{lead.status}</StatusTag>
                </TD>
                <TD className="font-semibold text-zinc-700">{lead.inbound}</TD>
                <TD className="font-semibold whitespace-nowrap text-zinc-900">{lead.owner}</TD>
                <TD align="right" className="font-medium whitespace-nowrap text-zinc-600">
                  {formatDate(lead.createdAt)} <span className="text-zinc-400">{formatTime(lead.createdAt)}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
