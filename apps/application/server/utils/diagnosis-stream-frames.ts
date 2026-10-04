import type { DiagnosisStage } from '#shared/ai-diagnosis';

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The Server-Sent Events frames of the streaming diagnosis endpoint. */
export const diagnosisFrame = {
  stage: (stage: DiagnosisStage) => frame('stage', { stage }),
  thinking: (text: string) => frame('thinking', { text }),
  result: (diagnosis: unknown) => frame('result', diagnosis),
  error: (message: string) => frame('error', { message }),
};
