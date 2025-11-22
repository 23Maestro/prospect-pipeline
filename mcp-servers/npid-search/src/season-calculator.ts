export function calculateSeasonName(gradYear: number, currentDate: Date = new Date()): string {
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  let schoolYearEnd: number;
  if (currentMonth >= 8) {
    schoolYearEnd = currentYear + 1;
  } else {
    schoolYearEnd = currentYear;
  }

  const yearsUntilGrad = gradYear - schoolYearEnd;
  const gradeLevel = 12 - yearsUntilGrad;

  const seasonMap: Record<number, string> = {
    7: "7th Grade Season",
    8: "8th Grade Season",
    9: "Freshman Season",
    10: "Sophomore Season",
    11: "Junior Season",
    12: "Senior Season"
  };

  return seasonMap[gradeLevel] || "";
}
