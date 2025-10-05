/**
 * Content Generation Tool
 * 
 * Generates consistent naming/formatting for:
 * - YouTube video titles
 * - Dropbox folder names
 * - Approved video titles
 * 
 * Uses Student Athlete properties consistently across Notion and NPID
 */

type Input = {
  athleteName: string;
  sport?: string;
  class?: string; // class year
  positions?: string; // pipe-separated positions
  highSchool?: string;
  city?: string;
  state?: string;
  contentType: "youtube-title" | "dropbox-folder" | "approved-video-title";
  additionalContext?: string;
};

function toPascalCase(name: string): string {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export default async function tool(input: Input): Promise<string> {
  const name = (input.athleteName || "").trim();
  const sport = (input.sport || "").trim();
  const gradYear = (input.class || "").trim();
  const positions = (input.positions || "").trim();
  const highSchool = (input.highSchool || "").trim();
  const city = (input.city || "").trim();
  const state = (input.state || "").trim();
  const context = (input.additionalContext || "").trim();

  switch (input.contentType) {
    case "youtube-title": {
      // Example: "Ava Johnson | Class of 2026 | Soccer Highlights"
      const parts = [name, gradYear ? `Class of ${gradYear}` : "", sport ? `${sport} Highlights` : "Highlights"]
        .filter(Boolean)
        .join(" | ");
      return parts;
    }
    case "dropbox-folder": {
      // Example: "AvaJohnson_2026_Soccer_FL"
      const pascal = toPascalCase(name);
      const pieces = [pascal, gradYear, sport, state].filter(Boolean).join("_");
      return pieces || pascal || name;
    }
    case "approved-video-title": {
      // Format:
      // [STUDENT_ATHLETE_NAME]
      // Class of [GRAD_YEAR] - [POSITIONS_PIPE_SEPARATED]
      // [HIGH_SCHOOL_NAME]
      // [CITY], [STATE_ABBR]
      const lines = [];
      
      // Student athlete name
      if (name) lines.push(name);
      
      // Class year and positions
      const classLine = [];
      if (gradYear) classLine.push(`Class of ${gradYear}`);
      if (positions) classLine.push(positions);
      if (classLine.length > 0) lines.push(classLine.join(" - "));
      
      // High school
      if (highSchool) lines.push(highSchool);
      
      // City and state
      const locationLine = [];
      if (city) locationLine.push(city);
      if (state) locationLine.push(state);
      if (locationLine.length > 0) lines.push(locationLine.join(", "));
      
      return lines.join("\n");
    }
  }

  // Fallback (should not happen due to enum)
  return name;
}
