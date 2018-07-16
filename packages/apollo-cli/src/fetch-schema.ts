import { fs } from "apollo-codegen-core/lib/localfs";
import * as path from "path";
import fetch from "node-fetch";
import gql from "graphql-tag";
import { buildSchema, execute as graphql, introspectionQuery } from "graphql";
import { execute, toPromise } from "apollo-link";
import { createHttpLink } from "apollo-link-http";

import { extractDocumentFromJavascript } from "apollo-codegen-core/lib/loading";
import { EndpointConfig } from "./config";
import { getIdFromKey, engineLink } from "./engine";
import { SCHEMA_QUERY } from "./operations/schema";

const introspection = gql(introspectionQuery);

const loadSchemaFromString = async (schemaSource: string) => {
  const schema = buildSchema(schemaSource);
  const localSchema = await graphql(schema, introspection);
  if (!localSchema || localSchema.errors)
    throw new Error(
      localSchema.errors!.map(({ message }) => message).join("\n")
    );
  return localSchema.data!.__schema;
};

export async function fromFile(file: string) {
  try {
    const result = fs.readFileSync(file, {
      encoding: "utf-8"
    });
    const ext = path.extname(file);

    // an actual introspectionQuery result
    if (ext === ".json") {
      const parsed = JSON.parse(result);
      return parsed.data
        ? parsed.data.__schema
        : parsed.__schema
          ? parsed.__schema
          : parsed;
    }

    if (ext === ".graphql" || ext === ".graphqls" || ext === ".gql") {
      return await loadSchemaFromString(result);
    }

    if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
      return await loadSchemaFromString(extractDocumentFromJavascript(result)!);
    }
  } catch (e) {
    throw new Error(`Unable to read file ${file}. ${e.message}`);
  }
}

export interface FetchParams {
  endpoint: string | undefined;
  header?: Object[];
}

export const fetchSchema = async ({ url, headers }: EndpointConfig) => {
  if (!url) throw new Error("No endpoint provided when fetching schema");
  if (fs.existsSync(url)) return fromFile(url);

  const headersObject = headers
    ? headers.reduce((current, next) => ({ ...current, ...next }), {})
    : {};

  return toPromise(
    // XXX node-fetch isn't compatiable typescript wise here?
    execute(createHttpLink({ uri: url, fetch } as any), {
      query: introspection,
      context: { headersObject }
    })
  ).then(({ data, errors }: any) => {
    if (errors)
      throw new Error(errors.map(({ message }: Error) => message).join("\n"));
    return data!.__schema;
  });
};

export async function fetchSchemaFromEngine(apiKey: string) {
  const variables = {
    id: getIdFromKey(apiKey as string),
    tag: "current"
  };

  const engineSchema = await toPromise(
    execute(engineLink, {
      query: SCHEMA_QUERY,
      variables,
      context: {
        headers: { ["x-api-key"]: apiKey }
      }
    })
  );

  if (engineSchema.data && engineSchema.data.service.schema) {
    return engineSchema.data.service.schema.__schema;
  } else {
    throw new Error("Unable to get schema from Apollo Engine");
  }
}
