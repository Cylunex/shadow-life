import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root=resolve(import.meta.dirname,"..");
const ignored=new Set(["node_modules","dist","generated","build","coverage",".git",".gradle"]);
const sourceExtensions=/\.(?:ts|tsx|js|mjs|cjs)$/u;
const textExtensions=/\.(?:ts|tsx|js|mjs|cjs|kt|sql|md|json)$/u;
const normalized=path=>path.split(sep).join("/");
const sideOf=path=>/^(server|client|shared)\//u.exec(path)?.[1];
const barePackage=specifier=>specifier.startsWith("@")?specifier.split("/").slice(0,2).join("/"):specifier.split("/")[0];

export function moduleSpecifiers(file,text){
  const result=[];
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function record(node){if(node&&ts.isStringLiteralLike(node))result.push(node.text);}
  function visit(node){
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))record(node.moduleSpecifier);
    else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))record(node.moduleReference.expression);
    else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))record(node.argument.literal);
    else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require")))record(node.arguments[0]);
    ts.forEachChild(node,visit);
  }
  visit(source);
  return [...new Set(result)];
}

export function sourceBoundaryViolations(file,text,packageRoots,workspaceRoot=root){
  const path=normalized(relative(workspaceRoot,file));
  const side=sideOf(path),isRuntime=/(?:^|\/)src\//u.test(path);
  const violations=[];
  for(const specifier of moduleSpecifiers(file,text)){
    let target;
    if(specifier.startsWith("."))target=normalized(relative(workspaceRoot,resolve(dirname(file),specifier)));
    else if(specifier.startsWith("file:")){
      try{target=normalized(relative(workspaceRoot,fileURLToPath(specifier)));}catch{/* Module resolution will report invalid file URLs. */}
    }else if(specifier.startsWith("/"))target=normalized(relative(workspaceRoot,specifier));
    else target=packageRoots.get(barePackage(specifier));
    const targetSide=target?sideOf(target):undefined;
    if(isRuntime&&side==="client"&&targetSide==="server")violations.push(`${path}: client runtime must use the API, not ${specifier}`);
    if(isRuntime&&side==="server"&&targetSide==="client")violations.push(`${path}: server runtime must not import a client: ${specifier}`);
    if(side==="shared"&&targetSide&&targetSide!=="shared"&&!path.includes("/test/"))violations.push(`${path}: shared code must not import either side: ${specifier}`);
    const dependency=barePackage(specifier);
    if(path.startsWith("shared/contracts/")&&["hono","drizzle-orm","pg","pg-boss","react","react-dom"].includes(dependency))violations.push(`${path}: contracts must stay independent of ${specifier}`);
    if(path.startsWith("server/kernel/")&&(["hono","drizzle-orm","pg","pg-boss","react","react-dom"].includes(dependency)||(target?.startsWith("server/")&&!target.startsWith("server/kernel/"))))violations.push(`${path}: kernel imported an adapter or framework: ${specifier}`);
    if(isRuntime&&side==="client"&&["drizzle-orm","pg","pg-boss"].includes(dependency))violations.push(`${path}: client runtime must not import database implementation ${specifier}`);
    if(isRuntime&&path.startsWith("server/mcp/")){
      if(targetSide==="server"&&!target.startsWith("server/mcp/"))violations.push(`${path}: MCP must use the HTTP API, not server implementation ${specifier}`);
      if(["drizzle-orm","pg","pg-boss"].includes(dependency))violations.push(`${path}: MCP must not import database implementation ${specifier}`);
    }
  }
  return [...new Set(violations)];
}

export async function checkBoundaries(workspaceRoot=root){
  const files=[],packageRoots=new Map();
  async function scan(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(ignored.has(entry.name))continue;
      const path=resolve(directory,entry.name);
      if(entry.isDirectory())await scan(path);
      else if(entry.isFile()&&textExtensions.test(entry.name)){
        const text=await readFile(path,"utf8");files.push({path,text});
        if(entry.name==="package.json"){
          const name=JSON.parse(text).name;
          if(typeof name==="string")packageRoots.set(name,normalized(relative(workspaceRoot,directory))+"/");
        }
      }
    }
  }
  await scan(workspaceRoot);
  const violations=[];
  for(const {path,text}of files){
    const local=normalized(relative(workspaceRoot,path));
    const internalLegacyArtifact=local.startsWith("server/database/migrations/")||local==="server/database/src/schema.ts"||local==="server/database/src/migrate.ts"||local.startsWith("server/database/test/");
    const publicVersionMarker=!internalLegacyArtifact&&/\/api\/v\d+\b|shadow\.[a-z0-9_.-]+\.v\d+\b|capability_version/u.test(text);
    if(local!=="scripts/check-boundaries.mjs"&&publicVersionMarker)violations.push(`${local}: public contracts use one current version`);
    if(sourceExtensions.test(path))violations.push(...sourceBoundaryViolations(path,text,packageRoots,workspaceRoot));
  }
  return violations;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const violations=await checkBoundaries();
  if(violations.length){console.error(violations.join("\n"));process.exitCode=1;}
  else console.log("Dependency boundaries are valid.");
}
