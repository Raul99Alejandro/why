import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
export type Speaker = (text: string) => Promise<Uint8Array>;
export function pollySpeaker(client: PollyClient, voice = 'Joanna'): Speaker {
  return async text => {
    const out = await client.send(new SynthesizeSpeechCommand({ Text: text, VoiceId: voice as never, Engine: 'neural', OutputFormat: 'mp3' }));
    if (!out.AudioStream) throw new Error('empty reply from Polly');
    return out.AudioStream.transformToByteArray();
  };
}
