export interface AthleteSummary {
  id: string;
  name: string;
  gradYear: number;
  sport: "Football" | "Basketball" | "Baseball" | "Soccer" | "Volleyball" | "Softball";
  state: string;
}

export interface AthleteDetails extends AthleteSummary {
  jerseyNumber?: string;
  positions?: string;
  highSchool?: string;
  city?: string;
  seasonName?: string;
  athleteMainId?: string;
}

export interface SessionData {
  cookies: string;
  expiresAt: string;
}
