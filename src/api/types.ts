export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "bearer";
};

export type WallabagInfo = {
  appname: "wallabag";
  version: string;
  allowed_registration?: boolean;
};
