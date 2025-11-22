import type { AthleteSummary, AthleteDetails } from '../types/athlete';
import { getAuthHeaders } from './session-loader';
import { calculateSeasonName } from './season-calculator';
import fetch from 'node-fetch';

export class NPIDClient {
  private baseUrl: string = "https://dashboard.nationalpid.com";

  private async getFreshCSRFToken(): Promise<string> {
    const headers = getAuthHeaders();
    const resp = await fetch(`${this.baseUrl}/rulestemplates/template/videoteammessagelist`, { headers });
    const html = await resp.text();
    const match = html.match(/<input[^>]*name="_token"[^>]*value="([^"]+)"/);
    if (!match) throw new Error('No CSRF token found in page');
    return match[1];
  }

  async searchPlayer(query: string): Promise<AthleteSummary[]> {
    const [firstName, ...lastNameParts] = query.split(' ');
    const lastName = lastNameParts.join(' ');

    const csrfToken = await this.getFreshCSRFToken();
    const headers = getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/videoteammsg/videoprogress`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({
        _token: csrfToken,
        first_name: firstName,
        last_name: lastName,
        email: '',
        sport: '0',
        states: '0',
        athlete_school: '0',
        editorassigneddatefrom: '',
        editorassigneddateto: '',
        grad_year: '',
        select_club_sport: '',
        select_club_state: '',
        select_club_name: '',
        video_editor: '',
        video_progress: '',
        video_progress_stage: '',
        video_progress_status: ''
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

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
    const csrfToken = await this.getFreshCSRFToken();
    const headers = getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/videoteammsg/videoprogress`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({
        _token: csrfToken,
        first_name: '',
        last_name: '',
        email: '',
        sport: '0',
        states: '0',
        athlete_school: '0',
        editorassigneddatefrom: '',
        editorassigneddateto: '',
        grad_year: '',
        select_club_sport: '',
        select_club_state: '',
        select_club_name: '',
        video_editor: '',
        video_progress: '',
        video_progress_stage: '',
        video_progress_status: ''
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

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
