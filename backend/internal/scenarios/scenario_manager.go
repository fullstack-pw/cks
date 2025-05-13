package scenarios

import (
	"fmt"
	"io"
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

// ScenarioManager handles loading and managing scenarios with improved thread safety
type ScenarioManager struct {
	scenariosDir string
	scenarios    map[string]*models.Scenario
	categories   map[string]string

	// Use RWMutex for better read concurrency
	scenarioMutex sync.RWMutex
	categoryMutex sync.RWMutex

	logger *logrus.Logger

	// Add file watcher support (future enhancement)
	watcherStop chan struct{}
}

func NewScenarioManager(scenariosDir string, logger *logrus.Logger) (*ScenarioManager, error) {
	sm := &ScenarioManager{
		scenariosDir: scenariosDir,
		scenarios:    make(map[string]*models.Scenario),
		categories:   make(map[string]string),
		logger:       logger,
		watcherStop:  make(chan struct{}),
	}

	// Load scenarios and categories
	if err := sm.loadScenarios(); err != nil {
		return nil, fmt.Errorf("failed to load scenarios: %w", err)
	}

	if err := sm.loadCategories(); err != nil {
		return nil, fmt.Errorf("failed to load categories: %w", err)
	}

	return sm, nil
}

// GetScenario returns a scenario by ID with proper locking
func (sm *ScenarioManager) GetScenario(id string) (*models.Scenario, error) {
	sm.scenarioMutex.RLock()
	defer sm.scenarioMutex.RUnlock()

	scenario, exists := sm.scenarios[id]
	if !exists {
		return nil, NewScenarioNotFoundError(id)
	}

	// Return a copy to prevent external modifications
	scenarioCopy := *scenario
	return &scenarioCopy, nil
}

// ListScenarios returns scenarios with optional filtering
func (sm *ScenarioManager) ListScenarios(category, difficulty, searchQuery string) ([]*models.Scenario, error) {
	sm.scenarioMutex.RLock()
	defer sm.scenarioMutex.RUnlock()

	// Create result slice with initial capacity
	scenarios := make([]*models.Scenario, 0, len(sm.scenarios))

	// Apply filters
	for _, scenario := range sm.scenarios {
		// Create a copy for each scenario
		scenarioCopy := *scenario

		// Filter by category
		if category != "" {
			categoryMatch := false
			for _, t := range scenarioCopy.Topics {
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
		if difficulty != "" && scenarioCopy.Difficulty != difficulty {
			continue
		}

		// Filter by search query
		if searchQuery != "" {
			searchQuery = strings.ToLower(searchQuery)
			title := strings.ToLower(scenarioCopy.Title)
			desc := strings.ToLower(scenarioCopy.Description)

			if !strings.Contains(title, searchQuery) && !strings.Contains(desc, searchQuery) {
				// Check topics
				topicMatch := false
				for _, topic := range scenarioCopy.Topics {
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
		scenarios = append(scenarios, &scenarioCopy)
	}

	// Sort scenarios by ID for consistent ordering
	sort.Slice(scenarios, func(i, j int) bool {
		return scenarios[i].ID < scenarios[j].ID
	})

	return scenarios, nil
}

// GetCategories returns all scenario categories with proper locking
func (sm *ScenarioManager) GetCategories() (map[string]string, error) {
	sm.categoryMutex.RLock()
	defer sm.categoryMutex.RUnlock()

	// Copy categories map to avoid race conditions
	categories := make(map[string]string, len(sm.categories))
	for k, v := range sm.categories {
		categories[k] = v
	}

	return categories, nil
}

// ReloadScenarios reloads all scenarios from disk
func (sm *ScenarioManager) ReloadScenarios() error {
	sm.scenarioMutex.Lock()
	defer sm.scenarioMutex.Unlock()

	// Clear existing scenarios
	sm.scenarios = make(map[string]*models.Scenario)

	// Reload scenarios without the lock (will acquire it when storing)
	sm.scenarioMutex.Unlock()
	err := sm.loadScenarios()
	sm.scenarioMutex.Lock()

	return err
}

// loadScenarios loads all scenarios from the directory
func (sm *ScenarioManager) loadScenarios() error {
	// Check if scenarios directory exists
	info, err := os.Stat(sm.scenariosDir)
	if err != nil {
		return NewIOError("stat", sm.scenariosDir, err)
	}

	if !info.IsDir() {
		return NewIOError("validate", sm.scenariosDir, fmt.Errorf("not a directory"))
	}

	// Read directory entries
	entries, err := os.ReadDir(sm.scenariosDir)
	if err != nil {
		return NewIOError("read directory", sm.scenariosDir, err)
	}

	// Collect errors but continue loading other scenarios
	var loadErrors []error

	// Process each scenario directory
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), "_") || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		scenarioID := entry.Name()
		scenarioPath := filepath.Join(sm.scenariosDir, scenarioID)

		// Load individual scenario
		scenario, err := sm.loadScenario(scenarioID, scenarioPath)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to load scenario %s", scenarioID)
			loadErrors = append(loadErrors, err)
			continue
		}

		// Store scenario with proper locking
		sm.scenarioMutex.Lock()
		sm.scenarios[scenario.ID] = scenario
		sm.scenarioMutex.Unlock()
	}

	sm.logger.WithField("count", len(sm.scenarios)).Info("Loaded scenarios")

	// Return error if no scenarios were loaded successfully
	if len(sm.scenarios) == 0 && len(loadErrors) > 0 {
		return fmt.Errorf("failed to load any scenarios: %v", loadErrors[0])
	}

	return nil
}

// loadScenario loads a single scenario with proper resource management
func (sm *ScenarioManager) loadScenario(scenarioID string, scenarioPath string) (*models.Scenario, error) {
	// Load metadata file
	metadataPath := filepath.Join(scenarioPath, "metadata.yaml")

	metadataFile, err := os.Open(metadataPath)
	if err != nil {
		return nil, NewIOError("open metadata", metadataPath, err)
	}
	defer metadataFile.Close()

	metadataContent, err := io.ReadAll(metadataFile)
	if err != nil {
		return nil, NewIOError("read metadata", metadataPath, err)
	}

	// Parse metadata
	var scenario models.Scenario
	if err := yaml.Unmarshal(metadataContent, &scenario); err != nil {
		return nil, NewScenarioInvalidError(scenarioID, fmt.Sprintf("invalid metadata YAML: %v", err))
	}

	// Set ID if not already set
	if scenario.ID == "" {
		scenario.ID = scenarioID
	}

	// Validate scenario metadata
	if err := sm.validateScenarioMetadata(&scenario); err != nil {
		return nil, NewScenarioInvalidError(scenarioID, err.Error())
	}

	// Load tasks
	if err := sm.loadTasks(&scenario, scenarioPath); err != nil {
		return nil, fmt.Errorf("failed to load tasks: %w", err)
	}

	// Load setup steps
	if err := sm.loadSetupSteps(&scenario, scenarioPath); err != nil {
		sm.logger.WithError(err).Warnf("Failed to load setup steps for scenario %s", scenarioID)
		// Continue without setup steps - they're optional
	}

	return &scenario, nil
}

// validateScenarioMetadata validates required scenario fields
func (sm *ScenarioManager) validateScenarioMetadata(scenario *models.Scenario) error {
	if scenario.Title == "" {
		return fmt.Errorf("missing required field: title")
	}
	if scenario.Description == "" {
		return fmt.Errorf("missing required field: description")
	}
	if scenario.Difficulty == "" {
		return fmt.Errorf("missing required field: difficulty")
	}

	// Validate difficulty value
	validDifficulties := map[string]bool{
		"beginner":     true,
		"intermediate": true,
		"advanced":     true,
	}

	if !validDifficulties[scenario.Difficulty] {
		return fmt.Errorf("invalid difficulty: %s", scenario.Difficulty)
	}

	return nil
}

// loadTasks loads tasks for a scenario
func (sm *ScenarioManager) loadTasks(scenario *models.Scenario, scenarioPath string) error {
	tasksDir := filepath.Join(scenarioPath, "tasks")

	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		if os.IsNotExist(err) {
			sm.logger.WithField("scenarioID", scenario.ID).Debug("No tasks directory found")
			return nil
		}
		return NewIOError("read tasks directory", tasksDir, err)
	}

	// Pattern for task files: 01-task.md, 02-task.md, etc.
	taskPattern := regexp.MustCompile(`^(\d+)-task\.md$`)

	for _, entry := range entries {
		if entry.IsDir() || !taskPattern.MatchString(entry.Name()) {
			continue
		}

		// Extract task ID from filename
		matches := taskPattern.FindStringSubmatch(entry.Name())
		taskID := matches[1]

		taskPath := filepath.Join(tasksDir, entry.Name())

		// Load task with proper resource management
		taskFile, err := os.Open(taskPath)
		if err != nil {
			sm.logger.WithError(err).Warnf("Failed to open task %s", taskPath)
			continue
		}

		taskContent, err := io.ReadAll(taskFile)
		taskFile.Close() // Close immediately after reading

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
		validationFile := fmt.Sprintf("%s-validation.yaml", taskID)
		validationPath := filepath.Join(scenarioPath, "validation", validationFile)

		if err := sm.loadValidationRules(&task, validationPath); err != nil {
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

// loadValidationRules loads validation rules for a task
func (sm *ScenarioManager) loadValidationRules(task *models.Task, validationPath string) error {
	// Check if validation file exists
	if _, err := os.Stat(validationPath); os.IsNotExist(err) {
		sm.logger.WithField("path", validationPath).Debug("No validation file found")
		return nil // Not an error, validation is optional
	}

	// Open file with proper resource management
	validationFile, err := os.Open(validationPath)
	if err != nil {
		return NewIOError("open validation", validationPath, err)
	}
	defer validationFile.Close()

	validationContent, err := io.ReadAll(validationFile)
	if err != nil {
		return NewIOError("read validation", validationPath, err)
	}

	// Parse validation YAML
	var validation struct {
		Validation []models.ValidationRule `yaml:"validation"`
	}

	if err := yaml.Unmarshal(validationContent, &validation); err != nil {
		return NewScenarioInvalidError(task.ID, fmt.Sprintf("invalid validation YAML: %v", err))
	}

	task.Validation = validation.Validation

	sm.logger.WithFields(logrus.Fields{
		"taskID":    task.ID,
		"ruleCount": len(task.Validation),
	}).Debug("Loaded validation rules")

	return nil
}

// parseTaskMarkdown remains the same as before, just adding proper error handling
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

// Stop gracefully shuts down the scenario manager
func (sm *ScenarioManager) Stop() {
	close(sm.watcherStop)
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
