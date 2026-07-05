interface GoogleTokenResponse {
  access_token: string;
  error?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface GoogleTokenClient {
  callback: (response: GoogleTokenResponse) => void;
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback?: (error: unknown) => void;
    }) => GoogleTokenClient;
    revoke: (token: string, callback?: () => void) => void;
  };
}

interface Window {
  google?: {
    accounts: GoogleAccounts;
  };
}
