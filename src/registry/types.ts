export type CanonicalEntry<Id extends string = string> = {
  id: Id;
  displayName: string;
  aliases: readonly string[];
};

export type PartnerEntry = CanonicalEntry & {
  /** External merchant ids. Not foreign keys. */
  merchantIds: readonly number[];
};

export type ServiceEntry = CanonicalEntry & {
  /** Bare lowercase Jira ARI UUIDs (customfield_10399) that identify this service. */
  aris: readonly string[];
};

export type ResolveResult<Id extends string> =
  | { status: "resolved"; id: Id }
  | { status: "unresolved"; raw: string };
