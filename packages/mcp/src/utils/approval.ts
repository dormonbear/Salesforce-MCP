const MAX_PREVIEW_RECORDS = 5;

export function buildApprovalMessage(toolName: string, targetOrg: string, input: Record<string, unknown>): string {
  const lines: string[] = [
    '⚠️ Operation requires approval',
    '',
    `Tool: ${toolName}`,
    `Target Org: ${targetOrg}`,
  ];

  if (toolName === 'salesforce_dml_records') {
    const operation = input.operation as string;
    const objectName = input.objectName as string;
    const records = input.records as Array<Record<string, unknown>>;
    lines.push(`Operation: ${operation} ${objectName}`);
    lines.push(`Record count: ${records.length}`);
    lines.push('');
    lines.push('Records:');
    const preview = records.slice(0, MAX_PREVIEW_RECORDS);
    for (const record of preview) {
      lines.push(`  ${JSON.stringify(record)}`);
    }
    if (records.length > MAX_PREVIEW_RECORDS) {
      lines.push(`  ... and ${records.length - MAX_PREVIEW_RECORDS} more`);
    }
  } else if (toolName === 'salesforce_execute_anonymous') {
    const apexCode = input.apexCode as string;
    lines.push(`Operation: Execute Anonymous Apex`);
    lines.push('');
    lines.push('Code:');
    lines.push(apexCode);
  } else if (toolName === 'salesforce_write_apex' || toolName === 'salesforce_write_apex_trigger') {
    const operation = input.operation as string;
    const name = (input.className ?? input.triggerName) as string;
    lines.push(`Operation: ${operation} ${name}`);
  } else {
    lines.push('');
    lines.push('Input:');
    lines.push(JSON.stringify(input, null, 2));
  }

  return lines.join('\n');
}

export const APPROVAL_SCHEMA = {
  type: 'object' as const,
  properties: {
    approved: {
      type: 'boolean' as const,
      description: 'Confirm execution of this operation',
    },
  },
  required: ['approved'],
};
