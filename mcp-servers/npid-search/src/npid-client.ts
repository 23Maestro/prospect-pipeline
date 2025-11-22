import type { AthleteSummary, AthleteDetails } from './types.js';
import { getAuthHeaders, loadSession } from './session.js';
import { calculateSeasonName } from './season-calculator.js';
import fetch from 'node-fetch';

export class NPIDClient {
  private baseUrl: string = "https://dashboard.nationalpid.com";

  async searchPlayer(query: string): Promise<AthleteSummary[]> {
    const [firstName, ...lastNameParts] = query.split(' ');
    const lastName = lastNameParts.join(' ');

    const session = loadSession();
    const csrfToken = session.cookies['XSRF-TOKEN'] || session.pk || '';
    const headers = getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/videoteammsg/videoprogress`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `_token=${encodeURIComponent(csrfToken)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}`,
    });

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    // Map API response to AthleteSummary interface
    return data.map((player: any) => ({
      id: player.athlete_id?.toString() || '',
      name: player.athletename || '',
      gradYear: player.grad_year || 0,
      sport: player.sport_name || '',
      state: player.high_school_state || '',
    }));
  }

  async getAthleteDetails(playerId: string): Promise<AthleteDetails | null> {
    // Search returns full details, so we search with empty query and filter by ID
    // This is more reliable than HTML scraping
    const session = loadSession();
    const csrfToken = session.cookies['XSRF-TOKEN'] || session.pk || '';
    const headers = getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/videoteammsg/videoprogress`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `_token=${encodeURIComponent(csrfToken)}&first_name=&last_name=`,
    });

    const data = await response.json();
    if (!Array.isArray(data)) return null;

    // Find athlete by ID
    const player = data.find((p: any) => p.athlete_id?.toString() === playerId);
    if (!player) return null;

    // Build positions string from primary/secondary/third
    const positions = [
      player.primaryposition,
      player.secondaryposition,
      player.thirdposition
    ].filter(p => p && p !== 'NA').join(', ');

    const gradYear = player.grad_year || 0;
    const seasonName = calculateSeasonName(gradYear);

    return {
      id: player.athlete_id?.toString() || playerId,
      name: player.athletename || '',
      gradYear,
      sport: player.sport_name || '',
      state: player.high_school_state || '',
      positions: positions || undefined,
      highSchool: player.high_school || undefined,
      city: player.high_school_city || undefined,
      seasonName: seasonName || undefined,
      athleteMainId: player.athlete_id?.toString(), // Use athlete_id as fallback
    };
  }
}
