/**
 * TypeScript interfaces for Xcode Cloud workflow API payloads
 */

// ======================
// Start Condition Types
// ======================

export interface CiBranchStartCondition {
    source: 'ALL_BRANCHES' | 'SPECIFIED_BRANCHES';
    patterns?: string[];
    filesAndFoldersRule?: {
        mode: 'START_IF_FILES_MATCH' | 'DO_NOT_START_IF_FILES_MATCH';
        patterns: string[];
    };
    autoCancel?: boolean;
}

export interface CiTagStartCondition {
    source: 'ALL_TAGS' | 'SPECIFIED_TAGS';
    patterns?: string[];
    autoCancel?: boolean;
}

export interface CiPullRequestStartCondition {
    source: 'ALL_BRANCHES' | 'SPECIFIED_BRANCHES';
    destination: 'ALL_BRANCHES' | 'SPECIFIED_BRANCHES';
    sourcePatterns?: string[];
    destinationPatterns?: string[];
    autoCancel?: boolean;
}

export interface CiScheduledStartCondition {
    frequency: 'WEEKLY' | 'DAILY' | 'HOURLY';
    days?: ('MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY')[];
    hour?: number;
    minute?: number;
    timezone?: string;
}

export interface CiManualBranchStartCondition {
    source: 'ALL_BRANCHES' | 'SPECIFIED_BRANCHES';
    patterns?: string[];
}

export interface CiManualTagStartCondition {
    source: 'ALL_TAGS' | 'SPECIFIED_TAGS';
    patterns?: string[];
}

export interface CiManualPullRequestStartCondition {
    source: 'ALL_BRANCHES' | 'SPECIFIED_BRANCHES';
    destination: 'ALL_BRANCHES' | 'SPECIFIED_BRANCHES';
}

// ======================
// Action Types
// ======================

export type CiActionPlatform = 'MACOS' | 'IOS' | 'TVOS' | 'WATCHOS' | 'VISIONOS';

export type CiActionType = 'BUILD' | 'ANALYZE' | 'TEST' | 'ARCHIVE';

export interface CiAction {
    name: string;
    actionType: CiActionType;
    platform: CiActionPlatform;
    scheme: string;
    destination?: 'ANY_IOS_DEVICE' | 'ANY_MAC' | 'ANY_TVOS_DEVICE' | 'ANY_WATCHOS_DEVICE' | 'ANY_VISIONOS_DEVICE';
    isRequiredToPass?: boolean;
}

// ======================
// Workflow Payloads
// ======================

export interface CiWorkflowCreatePayload {
    name: string;
    description?: string;
    isEnabled?: boolean;
    isLockedForEditing?: boolean;
    clean?: boolean;
    containerFilePath?: string;
    branchStartCondition?: CiBranchStartCondition;
    tagStartCondition?: CiTagStartCondition;
    pullRequestStartCondition?: CiPullRequestStartCondition;
    scheduledStartCondition?: CiScheduledStartCondition;
    manualBranchStartCondition?: CiManualBranchStartCondition;
    manualTagStartCondition?: CiManualTagStartCondition;
    manualPullRequestStartCondition?: CiManualPullRequestStartCondition;
    actions: CiAction[];
}

export interface CiWorkflowUpdatePayload {
    name?: string;
    description?: string;
    isEnabled?: boolean;
    isLockedForEditing?: boolean;
    clean?: boolean;
    containerFilePath?: string;
    branchStartCondition?: CiBranchStartCondition | null;
    tagStartCondition?: CiTagStartCondition | null;
    pullRequestStartCondition?: CiPullRequestStartCondition | null;
    scheduledStartCondition?: CiScheduledStartCondition | null;
    manualBranchStartCondition?: CiManualBranchStartCondition | null;
    manualTagStartCondition?: CiManualTagStartCondition | null;
    manualPullRequestStartCondition?: CiManualPullRequestStartCondition | null;
    actions?: CiAction[];
}

// ======================
// API Request Types
// ======================

export interface CiWorkflowCreateRequest {
    data: {
        type: 'ciWorkflows';
        attributes: CiWorkflowCreatePayload;
        relationships: {
            product: {
                data: {
                    type: 'ciProducts';
                    id: string;
                };
            };
            repository: {
                data: {
                    type: 'scmRepositories';
                    id: string;
                };
            };
            xcodeVersion: {
                data: {
                    type: 'ciXcodeVersions';
                    id: string;
                };
            };
            macOsVersion: {
                data: {
                    type: 'ciMacOsVersions';
                    id: string;
                };
            };
        };
    };
}

export interface CiWorkflowUpdateRequest {
    data: {
        type: 'ciWorkflows';
        id: string;
        attributes: CiWorkflowUpdatePayload;
    };
}

// ======================
// Response Types
// ======================

export interface CiWorkflowResponse {
    data: {
        type: 'ciWorkflows';
        id: string;
        attributes: {
            name: string;
            description?: string;
            isEnabled: boolean;
            isLockedForEditing: boolean;
            clean: boolean;
            containerFilePath?: string;
            lastModifiedDate?: string;
            branchStartCondition?: CiBranchStartCondition;
            tagStartCondition?: CiTagStartCondition;
            pullRequestStartCondition?: CiPullRequestStartCondition;
            scheduledStartCondition?: CiScheduledStartCondition;
            manualBranchStartCondition?: CiManualBranchStartCondition;
            manualTagStartCondition?: CiManualTagStartCondition;
            manualPullRequestStartCondition?: CiManualPullRequestStartCondition;
            actions: CiAction[];
        };
        relationships?: Record<string, any>;
    };
}
