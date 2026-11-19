import { adminGraphql, assertNoUserErrors } from './shopify.js';

const STAGED_UPLOADS_CREATE = `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id }
      userErrors { field message code }
    }
  }
`;

async function stageUpload({ bytes, mimeType, filename }) {
  const data = await adminGraphql(STAGED_UPLOADS_CREATE, {
    input: [
      {
        resource: 'IMAGE',
        filename,
        mimeType,
        httpMethod: 'POST',
        fileSize: String(bytes.byteLength),
      },
    ],
  });

  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  assertNoUserErrors('stagedUploadsCreate', userErrors);

  const [target] = stagedTargets;
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append('file', new Blob([bytes], { type: mimeType }), filename);

  const response = await fetch(target.url, { method: 'POST', body: form });
  if (!response.ok) {
    console.error('[files] staged upload failed', response.status, await response.text());
    throw new Error(`Staged upload failed with status ${response.status}`);
  }

  return target.resourceUrl;
}

export async function uploadImage({ bytes, mimeType, filename, alt }) {
  const resourceUrl = await stageUpload({ bytes, mimeType, filename });

  const data = await adminGraphql(FILE_CREATE, {
    files: [{ originalSource: resourceUrl, contentType: 'IMAGE', alt }],
  });

  const { files, userErrors } = data.fileCreate;
  assertNoUserErrors('fileCreate', userErrors);

  return files[0].id;
}
