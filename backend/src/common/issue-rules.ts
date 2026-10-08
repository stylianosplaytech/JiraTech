import { IssueType } from '@prisma/client';

export const EPIC_TYPES: IssueType[] = [
  IssueType.EPIC,
  IssueType.FEATURE_EPIC,
  IssueType.BAU_EPIC,
  IssueType.RELEASE_EPIC,
];

export const LEVEL2_TYPES: IssueType[] = [
  IssueType.STORY,
  IssueType.DEFECT,
  IssueType.TASK,
  IssueType.RELEASE_CANDIDATE,
];

export const SUBTASK_TYPES: IssueType[] = [
  IssueType.ANALYSIS,
  IssueType.BUG_FIX,
  IssueType.CODE,
  IssueType.CODE_REVIEW,
  IssueType.ARCH_REVIEW,
  IssueType.CODE_MERGE,
  IssueType.DOCUMENTATION,
  IssueType.TEST_CASE,
  IssueType.TEST_RUN,
  IssueType.DEPLOYMENT,
  IssueType.CONFIGURATION,
  IssueType.SUB_TASK,
];

export const VALID_PARENT_MAP: Record<IssueType, IssueType[]> = {
  [IssueType.EPIC]: [],
  [IssueType.FEATURE_EPIC]: [],
  [IssueType.BAU_EPIC]: [],
  [IssueType.RELEASE_EPIC]: [],
  [IssueType.STORY]: [...EPIC_TYPES],
  [IssueType.DEFECT]: [...EPIC_TYPES, IssueType.STORY],
  [IssueType.TASK]: [...EPIC_TYPES],
  [IssueType.RELEASE_CANDIDATE]: [IssueType.RELEASE_EPIC],
  [IssueType.ANALYSIS]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT, IssueType.RELEASE_CANDIDATE],
  [IssueType.BUG_FIX]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT, IssueType.RELEASE_CANDIDATE],
  [IssueType.CODE]: [IssueType.STORY],
  [IssueType.CODE_REVIEW]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT, IssueType.RELEASE_CANDIDATE],
  [IssueType.ARCH_REVIEW]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT, IssueType.RELEASE_CANDIDATE],
  [IssueType.CODE_MERGE]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT, IssueType.RELEASE_CANDIDATE],
  [IssueType.DOCUMENTATION]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT],
  [IssueType.TEST_CASE]: [...EPIC_TYPES, IssueType.STORY, IssueType.BAU_EPIC],
  [IssueType.TEST_RUN]: [...EPIC_TYPES, IssueType.STORY, IssueType.RELEASE_CANDIDATE, IssueType.RELEASE_EPIC],
  [IssueType.DEPLOYMENT]: [...EPIC_TYPES, IssueType.STORY, IssueType.RELEASE_CANDIDATE, IssueType.RELEASE_EPIC],
  [IssueType.CONFIGURATION]: [...EPIC_TYPES, IssueType.STORY, IssueType.RELEASE_CANDIDATE, IssueType.RELEASE_EPIC],
  [IssueType.SUB_TASK]: [...EPIC_TYPES, IssueType.STORY, IssueType.DEFECT, IssueType.TASK, IssueType.RELEASE_CANDIDATE],
};

export function isValidParentChild(childType: IssueType, parentType: IssueType | null): boolean {
  if (!parentType) {
    return EPIC_TYPES.includes(childType);
  }
  const allowed = VALID_PARENT_MAP[childType];
  if (!allowed?.includes(parentType)) return false;
  if (childType === IssueType.CODE && (EPIC_TYPES.includes(parentType) || parentType === IssueType.DEFECT)) {
    return false;
  }
  if (childType === IssueType.RELEASE_CANDIDATE && parentType !== IssueType.RELEASE_EPIC) {
    return false;
  }
  return true;
}

export const WORKFLOW_TRANSITIONS: Record<string, string[]> = {
  BACKLOG: ['TO_DO'],
  TO_DO: ['DOING', 'BACKLOG'],
  DOING: ['CLOSED', 'TO_DO'],
  CLOSED: ['TO_DO'], // re-open
};

export const PRIORITY_ORDER = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

// Defect priority matrix: severity × impact → priority
export function defectPriority(severity: 'HIGH' | 'MEDIUM' | 'LOW', impact: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  const matrix: Record<string, Record<string, string>> = {
    HIGH: { HIGH: 'HIGHEST', MEDIUM: 'HIGH', LOW: 'MEDIUM' },
    MEDIUM: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
    LOW: { HIGH: 'MEDIUM', MEDIUM: 'LOW', LOW: 'LOWEST' },
  };
  return matrix[severity][impact];
}
