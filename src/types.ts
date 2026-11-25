export type FaceAngleId = 'center' | 'left' | 'right' | 'up' | 'down';

export interface FaceAngleGuide {
  id: FaceAngleId;
  title: string;
  instruction: string;
  targetYaw: number;
  targetPitch: number;
}

export interface FaceScanFrame {
  angle: FaceAngleId;
  descriptor: number[];
  capturedAt: string;
  source: 'camera' | 'calibration';
}

export interface Face3DVertex {
  x: number;
  y: number;
  z: number;
  region: 'jaw' | 'brow' | 'eye' | 'nose' | 'mouth' | 'cheek';
}

export interface FaceComparisonResult {
  matched: boolean;
  similarity: number;
  geometricFit: number;
  threshold: number;
  perAngle: Array<{ angle: FaceAngleId; score: number }>;
  enrolledVertices: Face3DVertex[];
  liveVertices: Face3DVertex[];
}

export type VaultFileType = 'py' | 'md' | 'txt' | 'json' | 'ts';

export interface VaultFileRecord {
  id: string;
  filename: string;
  fileType: VaultFileType;
  encryptedPayload?: {
    ciphertext: string;
    iv: string;
    salt: string;
    algorithm: 'AES-256-GCM';
  };
  /** Plaintext is only kept in authenticated client memory / public community preview when published */
  content: string;
  contentHash: string;
  isEncrypted: boolean;
  isPublicCommunity: boolean;
  authorUsername: string;
  authorDisplayName: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: {
    github?: {
      synced: boolean;
      repo: string;
      path: string;
      commitSha?: string;
      htmlUrl?: string;
      error?: string;
      syncedAt?: string;
    };
    webhook?: {
      dispatched: boolean;
      targetUrl: string;
      statusCode?: number;
      deliveryId?: string;
      signature?: string;
      error?: string;
      dispatchedAt?: string;
    };
    community?: {
      published: boolean;
      postId: string;
    };
  };
}

export interface CommunityPost {
  id: string;
  fileId: string;
  filename: string;
  fileType: VaultFileType;
  content: string;
  contentHash: string;
  isEncryptedVaultCopy: boolean;
  authorUsername: string;
  authorDisplayName: string;
  likes: number;
  forks: number;
  githubUrl?: string;
  webhookDeliveryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryLog {
  id: string;
  event: 'file.saved' | 'file.published' | 'webhook.test';
  targetUrl: string;
  filename: string;
  authorUsername: string;
  statusCode: number;
  ok: boolean;
  signature: string;
  payloadPreview: string;
  createdAt: string;
  error?: string;
}

export interface GitHubConfigSummary {
  owner: string;
  repo: string;
  branch: string;
  folder: string;
  hasToken: boolean;
  maskedToken: string;
}

export interface WebhookConfigSummary {
  webhookUrl: string;
  hasSecret: boolean;
  autoDispatchOnSave: boolean;
  format: 'json' | 'discord';
}

export interface AuthUser {
  username: string;
  displayName: string;
  createdAt: string;
  faceEnrolledAngles: number;
  biometricFingerprint: string;
  githubConfig: GitHubConfigSummary;
  webhookConfig: WebhookConfigSummary;
}
