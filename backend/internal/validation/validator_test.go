package validation

import (
	"context"
	"testing"

	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestValidationEngine(t *testing.T) {
	tests := []struct {
		name     string
		rule     models.ValidationRule
		expected bool
	}{
		{
			name: "resource exists - pod",
			rule: models.ValidationRule{
				ID:   "test-pod-exists",
				Type: "resource_exists",
				Resource: &models.ResourceTarget{
					Kind:      "Pod",
					Name:      "test-pod",
					Namespace: "default",
				},
				ErrorMessage: "Pod not found",
			},
			expected: true,
		},
		{
			name: "resource property - security context",
			rule: models.ValidationRule{
				ID:   "test-security-context",
				Type: "resource_property",
				Resource: &models.ResourceTarget{
					Kind:      "Pod",
					Name:      "test-pod",
					Namespace: "default",
					Property:  ".spec.securityContext.runAsUser",
				},
				Condition:    "equals",
				Value:        "1000",
				ErrorMessage: "Wrong user ID",
			},
			expected: true,
		},
	}

	// Add the actual test execution
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Mock the kubevirtClient or use a test implementation
			engine := &Engine{
				kubevirtClient: nil, // Use a mock here in real tests
			}

			// Mock session
			session := &models.Session{
				ID:             "test-session",
				Namespace:      "test-namespace",
				ControlPlaneVM: "control-plane-vm",
				WorkerNodeVM:   "worker-vm",
			}

			// This is a simplified test - in reality you'd mock the ExecuteCommandInVM calls
			ctx := context.Background()
			detail, err := engine.validateRule(ctx, session, tt.rule)

			assert.NoError(t, err)
			assert.Equal(t, tt.expected, detail.Passed)
		})
	}
}
