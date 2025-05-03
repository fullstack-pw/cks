// internal/scenarios/scenario_manager.go - Scenario loading and management

package scenarios

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"gopkg.in/yaml.v2"

	"github.com/fullstack-pw/cks/backend/internal/models"
)

// ScenarioManager handles loading and managing scenarios
type ScenarioManager struct {
	scenariosDir string
	scenarios    map[string]*models.Scenario
	categories   map[string]string
	lock         sync.RWMutex
}

// NewScenarioManager creates a new scenario manager
func NewScenarioManager(scenariosDir string) (*ScenarioManager, error) {
	sm := &ScenarioManager{
		scenariosDir: scenariosDir,
		scenarios:    make(map[string]*models.Scenario),
		categories:   make(map[string]string),
	}

	// Load scenarios and categories
	err := sm.loadScenarios()
	if err != nil {
		return nil, err
	}

	err = sm.loadCategories()
	if err != nil {
		return nil, err
	}

	return sm, nil
}

// GetScenario returns a scenario by ID
func (sm *ScenarioManager) GetScenario(id string) (*models.Scenario, error) {
	sm.lock.RLock()
	defer sm.lock.RUnlock()

	scenario, exists := sm.scenarios[id]
	if !exists {
		return nil, fmt.Errorf("scenario not found: %s", id)
	}

	return scenario, nil
}

// ListScenarios returns all scenarios with optional filtering
func (sm *ScenarioManager) ListScenarios(category, difficulty, searchQuery string) ([]*models.Scenario, error) {
	sm.lock.RLock()
	defer sm.lock.RUnlock()

	// Create result slice with initial capacity
	scenarios := make([]*models.Scenario, 0, len(sm.scenarios))

	// Apply filters
	for _, scenario := range sm.scenarios {
		// Filter by category
		if category != "" {
			categoryMatch := false
			for _, t := range scenario.Topics {
				if t == category {
					categoryMatch = true
					break
				}
			}
			if !categoryMatch {
				continue
			}
		}

		// Filter by difficulty
		if difficulty != "" && scenario.Difficulty != difficulty {
			continue
		}

		// Filter by search query
		if searchQuery != "" {
			searchQuery = strings.ToLower(searchQuery)
			title := strings.ToLower(scenario.Title)
			desc := strings.ToLower(scenario.Description)

			if !strings.Contains(title, searchQuery) && !strings.Contains(desc, searchQuery) {
				// Check topics
				topicMatch := false
				for _, topic := range scenario.Topics {
					if strings.Contains(strings.ToLower(topic), searchQuery) {
						topicMatch = true
						break
					}
				}

				if !topicMatch {
					continue
				}
			}
		}

		// Add scenario to results
		scenarios = append(scenarios, scenario)
	}

	return scenarios, nil
}

// GetCategories returns all scenario categories
func (sm *ScenarioManager) GetCategories() (map[string]string, error) {
	sm.lock.RLock()
	defer sm.lock.RUnlock()

	// Copy categories map to avoid race conditions
	categories := make(map[string]string, len(sm.categories))
	for k, v := range sm.categories {
		categories[k] = v
	}

	return categories, nil
}

// ReloadScenarios reloads all scenarios from disk
func (sm *ScenarioManager) ReloadScenarios() error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	// Clear existing scenarios
	sm.scenarios = make(map[string]*models.Scenario)

	// Reload scenarios
	return sm.loadScenarios()
}

// loadScenarios loads all scenarios from the scenarios directory
func (sm *ScenarioManager) loadScenarios() error {
	// Check if scenarios directory exists
	info, err := os.Stat(sm.scenariosDir)
	if err != nil {
		return fmt.Errorf("failed to access scenarios directory: %v", err)
	}

	if !info.IsDir() {
		return fmt.Errorf("scenarios path is not a directory: %s", sm.scenariosDir)
	}

	// Get all scenario directories
	entries, err := os.ReadDir(sm.scenariosDir)
	if err != nil {
		return fmt.Errorf("failed to read scenarios directory: %v", err)
	}

	// Process each scenario directory
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		scenarioID := entry.Name()
		scenarioPath := filepath.Join(sm.scenariosDir, scenarioID)

		// Load metadata file
		metadataPath := filepath.Join(scenarioPath, "metadata.yaml")
		metadataFile, err := os.Open(metadataPath)
		if err != nil {
			fmt.Printf("Warning: failed to open metadata file for scenario %s: %v\n", scenarioID, err)
			continue
		}
		defer metadataFile.Close()

		metadataContent, err := ioutil.ReadAll(metadataFile)
		if err != nil {
			fmt.Printf("Warning: failed to read metadata file for scenario %s: %v\n", scenarioID, err)
			continue
		}

		// Parse metadata
		var scenario models.Scenario
		err = yaml.Unmarshal(metadataContent, &scenario)
		if err != nil {
			fmt.Printf("Warning: failed to parse metadata file for scenario %s: %v\n", scenarioID, err)
			continue
		}

		// Set ID if not already set
		if scenario.ID == "" {
			scenario.ID = scenarioID
		}

		// Load tasks
		err = sm.loadTasks(&scenario, scenarioPath)
		if err != nil {
			fmt.Printf("Warning: failed to load tasks for scenario %s: %v\n", scenarioID, err)
			continue
		}

		// Store scenario
		sm.scenarios[scenario.ID] = &scenario
	}

	return nil
}

// loadTasks loads all tasks for a scenario
func (sm *ScenarioManager) loadTasks(scenario *models.Scenario, scenarioPath string) error {
	tasksDir := filepath.Join(scenarioPath, "tasks")

	// Check if tasks directory exists
	info, err := os.Stat(tasksDir)
	if err != nil {
		return fmt.Errorf("failed to access tasks directory: %v", err)
	}

	if !info.IsDir() {
		return fmt.Errorf("tasks path is not a directory: %s", tasksDir)
	}

	// Get all task files
	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		return fmt.Errorf("failed to read tasks directory: %v", err)
	}

	// Process each task file
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		taskPath := filepath.Join(tasksDir, entry.Name())

		// Load task content
		taskContent, err := os.ReadFile(taskPath)
		if err != nil {
			fmt.Printf("Warning: failed to read task file %s: %v\n", taskPath, err)
			continue
		}

		// Extract task ID from filename
		taskID := strings.TrimSuffix(entry.Name(), ".md")

		// Extract title from first line of markdown
		lines := strings.Split(string(taskContent), "\n")
		title := ""
		if len(lines) > 0 && strings.HasPrefix(lines[0], "# ") {
			title = strings.TrimPrefix(lines[0], "# ")
		} else {
			title = fmt.Sprintf("Task %s", taskID)
		}

		// Create task
		task := models.Task{
			ID:          taskID,
			Title:       title,
			Description: string(taskContent),
		}

		// Load validation rules for this task
		validationPath := filepath.Join(scenarioPath, "validation", fmt.Sprintf("%s-validation.yaml", taskID))
		err = sm.loadValidationRules(&task, validationPath)
		if err != nil {
			fmt.Printf("Warning: failed to load validation rules for task %s: %v\n", taskID, err)
		}

		// Add task to scenario
		scenario.Tasks = append(scenario.Tasks, task)
	}

	return nil
}

// loadValidationRules loads validation rules for a task
func (sm *ScenarioManager) loadValidationRules(task *models.Task, validationPath string) error {
	// Check if validation file exists
	_, err := os.Stat(validationPath)
	if err != nil {
		return err
	}

	// Read validation file
	validationContent, err := os.ReadFile(validationPath)
	if err != nil {
		return err
	}

	// Parse validation rules
	var validation struct {
		Criteria []models.ValidationRule `yaml:"criteria"`
	}

	err = yaml.Unmarshal(validationContent, &validation)
	if err != nil {
		return err
	}

	// Add validation rules to task
	task.Validation = validation.Criteria

	return nil
}

// loadCategories loads category definitions
func (sm *ScenarioManager) loadCategories() error {
	// Default categories if no categories file exists
	defaultCategories := map[string]string{
		"pod-security":     "Pod Security",
		"network-security": "Network Security",
		"rbac":             "RBAC and Authentication",
		"secrets":          "Secrets Management",
		"etcd-security":    "ETCD Security",
		"runtime-security": "Runtime Security",
	}

	// Check if categories file exists
	categoriesPath := filepath.Join(sm.scenariosDir, "categories.yaml")
	_, err := os.Stat(categoriesPath)
	if err != nil {
		// Use default categories
		sm.categories = defaultCategories
		return nil
	}

	// Read categories file
	categoriesContent, err := os.ReadFile(categoriesPath)
	if err != nil {
		return err
	}

	// Parse categories
	var categories struct {
		Categories map[string]struct {
			Name        string `yaml:"name"`
			Description string `yaml:"description"`
		} `yaml:"categories"`
	}

	err = yaml.Unmarshal(categoriesContent, &categories)
	if err != nil {
		return err
	}

	// Convert to simple map
	sm.categories = make(map[string]string, len(categories.Categories))
	for id, category := range categories.Categories {
		sm.categories[id] = category.Name
	}

	return nil
}
