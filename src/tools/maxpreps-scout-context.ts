import { Action, Tool } from '@raycast/api';
import { resolveMaxPrepsScoutContext } from '../lib/maxpreps-scout-context';

type Input = {
  athleteName?: string;
  highSchool: string;
  city?: string;
  state: string;
  sport: string;
  maxPrepsUrl?: string;
};

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  if (!input.highSchool || !input.state || !input.sport) {
    return {
      style: Action.Style.Destructive,
      message: 'Missing required highSchool, state, or sport.',
    };
  }

  return {
    message: `Resolve MaxPreps context for ${input.highSchool}?`,
    info: [
      { name: 'Athlete', value: input.athleteName || 'Not provided' },
      { name: 'School', value: input.highSchool },
      { name: 'State', value: input.state },
      { name: 'Sport', value: input.sport },
      { name: 'URL', value: input.maxPrepsUrl || 'Search web' },
    ],
  };
};

export default async function tool(input: Input): Promise<string> {
  try {
    const result = await resolveMaxPrepsScoutContext(input);
    return JSON.stringify(
      {
        success: Boolean(result),
        result,
      },
      null,
      2,
    );
  } catch (error) {
    return JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  }
}
