// frontend/utils/validationDescriptions.js

export const getValidationDescription = (ruleId, scenarioId) => {
  // Scenario-specific descriptions
  const scenarioDescriptions = {
    'basic-pod-security': {
      'pod-exists': 'Pod "secure-pod" exists in the default namespace',
      'security-context': 'Pod is running as non-root user (UID 1000)',
      'no-privilege-escalation': 'Privilege escalation is disabled for the container',
      'pod-running': 'Pod is in Running state and ready',
      'custom-check': 'Pod process is actually running with UID 1000'
    },
    'network-policies': {
      'policy-exists': 'NetworkPolicy exists in the namespace',
      'ingress-rules': 'Ingress rules are properly configured',
      'egress-rules': 'Egress rules restrict outbound traffic',
      'pod-isolation': 'Pods are properly isolated'
    },
    'rbac-configuration': {
      'role-exists': 'Required Role/ClusterRole is created',
      'binding-exists': 'RoleBinding/ClusterRoleBinding is configured',
      'permissions-check': 'Permissions are correctly scoped',
      'service-account': 'ServiceAccount has proper permissions'
    }
  };

  // Get scenario-specific description if available
  if (scenarioId && scenarioDescriptions[scenarioId] && scenarioDescriptions[scenarioId][ruleId]) {
    return scenarioDescriptions[scenarioId][ruleId];
  }

  // Generic descriptions by validation type
  const genericDescriptions = {
    // Resource validations
    'resource_exists': 'Kubernetes resource exists',
    'resource_property': 'Resource property matches expected value',

    // Command validations
    'command': 'Command execution successful',
    'output_equals': 'Command output matches expected value',
    'output_contains': 'Command output contains required text',

    // Script validations
    'script': 'Script execution completed successfully',

    // File validations
    'file_exists': 'Required file exists',
    'file_content': 'File content matches requirements'
  };

  // Check generic descriptions
  if (genericDescriptions[ruleId]) {
    return genericDescriptions[ruleId];
  }

  // Pattern-based descriptions
  if (ruleId.includes('pod') && ruleId.includes('exists')) {
    const podName = ruleId.replace('-exists', '').replace('pod-', '');
    return `Pod "${podName}" exists`;
  }
  if (ruleId.includes('check')) {
    return `Validation: ${ruleId.replace('-check', '').replace(/-/g, ' ')}`;
  }

  // Default formatting
  return ruleId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export const getValidationCategory = (ruleId) => {
  const categories = {
    'pod-exists': 'Resource Creation',
    'security-context': 'Security Configuration',
    'no-privilege-escalation': 'Security Configuration',
    'pod-running': 'Resource Status',
    'custom-check': 'Runtime Verification'
  };

  return categories[ruleId] || 'General Validation';
};