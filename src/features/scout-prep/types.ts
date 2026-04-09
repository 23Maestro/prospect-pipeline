export type ScoutPrepGrade = 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';

export type ScoutPrepFormValues = {
  athleteName: string;
  parent1Name: string;
  parent2Name?: string;
  gradYear: ScoutPrepGrade;
  sport: string;
};
