export function guardrailEnabled() {
  return ['1', 'true', 'yes'].includes(String(process.env.BEDROCK_GUARDRAIL_ENABLED || '').toLowerCase());
}

function guardrailBaseConfig() {
  const guardrailIdentifier = process.env.BEDROCK_GUARDRAIL_ID || process.env.BEDROCK_GUARDRAIL_IDENTIFIER;
  const guardrailVersion = process.env.BEDROCK_GUARDRAIL_VERSION;
  if (!guardrailEnabled() || !guardrailIdentifier || !guardrailVersion) return null;
  return {
    guardrailIdentifier,
    guardrailVersion,
    trace: process.env.BEDROCK_GUARDRAIL_TRACE || 'enabled'
  };
}

export function guardrailConfig() {
  return guardrailBaseConfig();
}

export function guardrailStreamConfig() {
  const config = guardrailBaseConfig();
  if (!config) return null;
  return {
    ...config,
    streamProcessingMode: process.env.BEDROCK_GUARDRAIL_STREAM_PROCESSING_MODE || 'sync'
  };
}

export function summarizeGuardrailTrace(trace) {
  const guardrail = trace?.guardrail || trace;
  if (!guardrail || typeof guardrail !== 'object') return null;
  const inputAssessments = Object.values(guardrail.inputAssessment || {});
  const outputAssessments = Object.values(guardrail.outputAssessments || guardrail.outputAssessment || {});
  const assessments = [...inputAssessments, ...outputAssessments];
  const actionText = String(guardrail.action || guardrail.actionReason || '');
  const blocked = /\b(block|blocked|intervened|intervention)\b/i.test(actionText) || assessments.some((assessment) => {
    const filters = [
      ...(assessment.contentPolicy?.filters || []),
      ...(assessment.sensitiveInformationPolicy?.piiEntities || []),
      ...(assessment.topicPolicy?.topics || [])
    ];
    return filters.some((filter) => String(filter.action || '').toUpperCase() === 'BLOCK');
  });
  return {
    action: actionText,
    blocked
  };
}
