// frontend/utils/validationHelpers.js

export const formatValidationRule = (rule) => {
  switch (rule.type) {
    case 'resource_exists':
      return {
        title: `Check if ${rule.resource.kind} "${rule.resource.name}" exists`,
        description: `Verify that the ${rule.resource.kind} resource named "${rule.resource.name}" exists in the ${rule.resource.namespace || 'default'} namespace`
      };

    case 'resource_property':
      return {
        title: `Check ${rule.resource.kind} property`,
        description: `Verify that ${rule.resource.kind} "${rule.resource.name}" has property ${rule.resource.property} ${rule.condition} ${rule.value}`
      };

    case 'command':
      return {
        title: 'Command execution check',
        description: `Execute command and verify it ${rule.condition}`
      };

    case 'script':
      return {
        title: 'Custom script validation',
        description: 'Run custom validation script'
      };

    default:
      return {
        title: rule.id,
        description: rule.description || rule.errorMessage
      };
  }
};

export const parseValidationMessage = (message) => {
  // Parse common patterns in validation messages
  const patterns = {
    expected: /expected '([^']+)'/,
    got: /got '([^']+)'/,
    notFound: /not found/i,
    failed: /failed/i,
    success: /success|passed/i
  };

  const result = {
    type: 'unknown',
    details: {}
  };

  if (patterns.expected.test(message) && patterns.got.test(message)) {
    result.type = 'comparison';
    result.details.expected = message.match(patterns.expected)[1];
    result.details.actual = message.match(patterns.got)[1];
  } else if (patterns.notFound.test(message)) {
    result.type = 'not_found';
  } else if (patterns.success.test(message)) {
    result.type = 'success';
  }

  return result;
};