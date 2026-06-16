import type { DiagnoseImage } from './useClusterDiagnosis';

/**
 * Drag-and-drop / file-picker attachment handling for the AI diagnosis context:
 * collects text files (inlined into the prompt) and images (sent as multimodal
 * input), with size limits and base64 encoding. Extracted from ClusterDiagnosis
 * so that component stays focused on rendering.
 */

export interface AttachedFile {
  name: string;
  content: string;
  size: number;
}

export interface AttachedImage extends DiagnoseImage {
  preview: string;
  size: number;
}

const MAX_TEXT_BYTES = 200 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const part = (reader.result as string).split(',')[1];
      if (part !== undefined) resolve(part);
      else reject(new Error('Failed to read file'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useAttachments() {
  const toast = useToast();

  const files = ref<AttachedFile[]>([]);
  const images = ref<AttachedImage[]>([]);
  const dragOver = ref(false);

  async function processFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        if (file.size > MAX_IMAGE_BYTES) {
          toast.add({ title: 'Image too large', description: `${file.name} exceeds 5 MB`, color: 'error' });
          continue;
        }
        const data = await fileToBase64(file);
        const preview = `data:${file.type};base64,${data}`;
        images.value.push({ name: file.name, mediaType: file.type, data, preview, size: file.size });
      } else {
        if (file.size > MAX_TEXT_BYTES) {
          toast.add({ title: 'File too large', description: `${file.name} exceeds 200 KB`, color: 'error' });
          continue;
        }
        const content = await file.text();
        files.value.push({ name: file.name, content, size: file.size });
      }
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver.value = true;
  }

  function onDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement)?.contains(e.relatedTarget as Node)) {
      dragOver.value = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver.value = false;
    if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files);
  }

  function removeFile(i: number) {
    files.value.splice(i, 1);
  }

  function removeImage(i: number) {
    images.value.splice(i, 1);
  }

  /** Markdown block inlining the attached text files, or '' when there are none. */
  function filesMarkdown(): string {
    if (!files.value.length) return '';
    const blocks = files.value.map((f) => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``);
    return `## Attached Files\n\n${blocks.join('\n\n')}`;
  }

  /** Image payload for the diagnose request (drops the local preview/size fields). */
  function imagesPayload(): DiagnoseImage[] {
    return images.value.map((img) => ({ name: img.name, mediaType: img.mediaType, data: img.data }));
  }

  return {
    files,
    images,
    dragOver,
    processFiles,
    onDragOver,
    onDragLeave,
    onDrop,
    removeFile,
    removeImage,
    filesMarkdown,
    imagesPayload,
  };
}
