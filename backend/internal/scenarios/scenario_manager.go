// internal/scenarios/scenario_manager.go - Scenario loading and management

package scenarios

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/fullstack-pw/cks/backend/internal/models"
	"github.com/sirupsen/logrus"
	"gopkg.in/yaml.v2"
)

// ScenarioManager handles loading and managing scenarios
type ScenarioManager struct {
	scenariosDir string
	scenarios    map[string]*models.Scenario
	categories   map[string]string
	lock         sync.RWMutex
	logger       *logrus.Logger
}

func NewScenarioManager(scenariosDir string, logger *logrus.Logger) (*ScenarioManager, error) {
	sm := &ScenarioManager{
		scenariosDir: scenariosDir,
		scenarios:    make(map[string]*models.Scenario),
		categories:   make(map[string]string),
		logger:       logger,
	}

	// Load scenarios and categories
	err := sm.loadScenarios() // This is already being called here
	if err != nil {
		return nil, err
	}

	err = sm.loadCategories()
	if err != nil {
		return nil, err
	}

	return sm, nil
}

// Add this method to ScenarioManager if it's missing
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
			sm.logger.WithError(err).Warnf("Failed to open metadata for scenario %s", scenarioID)
			continue
		}
		defer metadataFile.Close()

		metadataContent, err := ioutil.ReadAll(metadataFile)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to read metadata for scenario %s", scenarioID)
			continue
		}

		// Parse metadata
		var scenario models.Scenario
		err = yaml.Unmarshal(metadataContent, &scenario)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to parse metadata for scenario %s", scenarioID)
			continue
		}

		// Set ID if not already set
		if scenario.ID == "" {
			scenario.ID = scenarioID
		}

		// Load tasks
		err = sm.loadTasks(&scenario, scenarioPath)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to load tasks for scenario %s", scenarioID)
			continue
		}

		// Load setup steps
		err = sm.loadSetupSteps(&scenario, scenarioPath)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to load setup steps for scenario %s", scenarioID)
			// Continue without setup steps
		}

		// Store scenario
		sm.scenarios[scenario.ID] = &scenario
	}

	sm.logger.WithField("count", len(sm.scenarios)).Info("Loaded scenarios")
	return nil
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

// Update loadTasks method to handle markdown files correctly
func (sm *ScenarioManager) loadTasks(scenario *models.Scenario, scenarioPath string) error {
	tasksDir := filepath.Join(scenarioPath, "tasks")

	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		// Tasks directory might not exist
		sm.logger.WithField("scenarioID", scenario.ID).Debug("No tasks directory found")
		return nil
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}

		// Extract task ID from filename (e.g., "01-task.md" -> "01")
		taskID := strings.TrimSuffix(strings.TrimSuffix(entry.Name(), ".md"), "-task")

		taskPath := filepath.Join(tasksDir, entry.Name())
		taskContent, err := os.ReadFile(taskPath)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to read task %s", taskPath)
			continue
		}

		// Parse markdown to extract task details
		task, err := sm.parseTaskMarkdown(taskID, string(taskContent))
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to parse task %s", taskPath)
			continue
		}

		// Load validation for this task
		validationPath := filepath.Join(scenarioPath, "validation", fmt.Sprintf("%s-validation.yaml", taskID))
		err = sm.loadValidationRules(&task, validationPath)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to load validation for task %s", taskID)
			// Continue without validation
		}

		scenario.Tasks = append(scenario.Tasks, task)
	}

	// Sort tasks by ID to ensure correct order
	sort.Slice(scenario.Tasks, func(i, j int) bool {
		return scenario.Tasks[i].ID < scenario.Tasks[j].ID
	})

	sm.logger.WithFields(logrus.Fields{
		"scenarioID": scenario.ID,
		"taskCount":  len(scenario.Tasks),
	}).Debug("Loaded tasks")

	return nil
}

// Enhanced markdown parser for task files
func (sm *ScenarioManager) parseTaskMarkdown(taskID, content string) (models.Task, error) {
	task := models.Task{ID: taskID}

	lines := strings.Split(content, "\n")
	currentSection := ""
	sectionContent := make(map[string][]string)

	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)

		// Extract title from H1
		if strings.HasPrefix(line, "# ") {
			task.Title = strings.TrimPrefix(line, "# ")
			continue
		}

		// Track current section from H2
		if strings.HasPrefix(line, "## ") {
			currentSection = strings.TrimPrefix(line, "## ")
			sectionContent[currentSection] = []string{}
			continue
		}

		// Add content to current section
		if currentSection != "" && trimmedLine != "" {
			sectionContent[currentSection] = append(sectionContent[currentSection], line)
		}
	}

	// Extract description
	if description, exists := sectionContent["Description"]; exists {
		task.Description = strings.Join(description, "\n")
	}

	// Extract objectives
	if objectives, exists := sectionContent["Objectives"]; exists {
		task.Objective = strings.Join(objectives, "\n")
	}

	// Extract step-by-step guide
	if steps, exists := sectionContent["Step-by-Step Guide"]; exists {
		task.Steps = sm.parseSteps(steps)
	}

	// Extract hints
	if hints, exists := sectionContent["Hints"]; exists {
		task.Hints = sm.parseHints(hints)
	}

	// If no title found in H1, try to extract from filename
	if task.Title == "" {
		task.Title = fmt.Sprintf("Task %s", taskID)
	}

	return task, nil
}

// Improved step parsing
func (sm *ScenarioManager) parseSteps(stepLines []string) []string {
	steps := []string{}
	currentStep := ""

	for _, line := range stepLines {
		trimmedLine := strings.TrimSpace(line)

		// Look for numbered steps (1., 2., etc.) or bullet points
		if regexp.MustCompile(`^\d+\.`).MatchString(trimmedLine) || strings.HasPrefix(trimmedLine, "-") {
			if currentStep != "" {
				steps = append(steps, currentStep)
			}
			currentStep = trimmedLine
		} else if trimmedLine != "" && currentStep != "" {
			// Continue previous step
			currentStep += " " + trimmedLine
		}
	}

	if currentStep != "" {
		steps = append(steps, currentStep)
	}

	return steps
}

// Improved hint parsing
func (sm *ScenarioManager) parseHints(hintLines []string) []string {
	hints := []string{}
	currentHint := ""
	inDetails := false

	for _, line := range hintLines {
		// Check for <details> block
		if strings.Contains(line, "<details>") {
			inDetails = true
			continue
		}

		if strings.Contains(line, "</details>") {
			if currentHint != "" {
				hints = append(hints, currentHint)
				currentHint = ""
			}
			inDetails = false
			continue
		}

		if inDetails {
			if strings.Contains(line, "<summary>") {
				// Extract hint title from summary
				summaryStart := strings.Index(line, "<summary>") + 9
				summaryEnd := strings.Index(line, "</summary>")
				if summaryEnd > summaryStart {
					currentHint = line[summaryStart:summaryEnd]
				}
			} else if strings.TrimSpace(line) != "" {
				// Add content to hint
				if currentHint != "" {
					currentHint += " " + strings.TrimSpace(line)
				}
			}
		}
	}

	return hints
}

// Add to ScenarioManager
func (sm *ScenarioManager) loadSetupSteps(scenario *models.Scenario, scenarioPath string) error {
	setupFile := filepath.Join(scenarioPath, "setup", "init.yaml")

	// Check if setup file exists
	if _, err := os.Stat(setupFile); os.IsNotExist(err) {
		sm.logger.WithField("scenarioID", scenario.ID).Debug("No setup file found")
		return nil // Not an error, setup is optional
	}

	content, err := os.ReadFile(setupFile)
	if err != nil {
		return fmt.Errorf("failed to read setup file: %w", err)
	}

	var setup struct {
		Steps []models.SetupStep `yaml:"steps"`
	}

	err = yaml.Unmarshal(content, &setup)
	if err != nil {
		return fmt.Errorf("failed to parse setup file: %w", err)
	}

	scenario.SetupSteps = setup.Steps

	sm.logger.WithFields(logrus.Fields{
		"scenarioID": scenario.ID,
		"stepCount":  len(scenario.SetupSteps),
	}).Debug("Loaded setup steps")

	return nil
}

// Fix validation loading to match actual file structure
func (sm *ScenarioManager) loadValidationRules(task *models.Task, validationPath string) error {
	// Check if validation file exists
	if _, err := os.Stat(validationPath); os.IsNotExist(err) {
		sm.logger.WithField("path", validationPath).Debug("No validation file found")
		return nil // Not an error, validation is optional
	}

	validationContent, err := os.ReadFile(validationPath)
	if err != nil {
		return fmt.Errorf("failed to read validation file: %w", err)
	}

	// Update structure to match actual YAML format
	var validation struct {
		Validation []models.ValidationRule `yaml:"validation"` // Changed from "criteria"
	}

	err = yaml.Unmarshal(validationContent, &validation)
	if err != nil {
		return fmt.Errorf("failed to parse validation file: %w", err)
	}

	task.Validation = validation.Validation

	sm.logger.WithFields(logrus.Fields{
		"taskID":    task.ID,
		"ruleCount": len(task.Validation),
	}).Debug("Loaded validation rules")

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

func parseSteps(stepLines []string) []string {
	steps := []string{}
	for _, line := range stepLines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "1.") || strings.HasPrefix(line, "2.") || strings.HasPrefix(line, "-") {
			steps = append(steps, line)
		}
	}
	return steps
}

func parseHints(hintLines []string) []string {
	hints := []string{}
	currentHint := ""
	inHint := false

	for _, line := range hintLines {
		if strings.Contains(line, "<summary>") {
			inHint = true
			// Extract hint title
			start := strings.Index(line, "<summary>") + 9
			end := strings.Index(line, "</summary>")
			if end > start {
				currentHint = line[start:end]
			}
		} else if strings.Contains(line, "</details>") {
			if currentHint != "" {
				hints = append(hints, currentHint)
				currentHint = ""
			}
			inHint = false
		} else if inHint && strings.TrimSpace(line) != "" {
			currentHint += " " + strings.TrimSpace(line)
		}
	}

	return hints
}
