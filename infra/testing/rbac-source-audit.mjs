import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const modulesRoot = path.join(root, 'apps/api/src');
const customPolicies = new Map([
  ['SofiaPublicPaymentsController', 'CAPABILITY_TOKEN'],
  ['SofiaWhatsappWebhookController', 'PROVIDER_SIGNATURE'],
  ['SofiaHermesWhatsappWebhookController', 'PROVIDER_SIGNATURE'],
  ['SofiaPaymentWebhooksController', 'PROVIDER_SIGNATURE'],
]);

const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.name.endsWith('.controller.ts')) files.push(target);
  }
}
walk(modulesRoot);

function decorators(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoratorCall(node, name) {
  for (const decorator of decorators(node)) {
    const expression = decorator.expression;
    if (ts.isCallExpression(expression) && expression.expression.getText() === name) return expression;
  }
  return null;
}

function literalArgument(call, index = 0) {
  const value = call?.arguments[index];
  return value && ts.isStringLiteralLike(value) ? value.text : '';
}

function hasGuard(node, guard) {
  return decoratorCall(node, 'UseGuards')?.arguments.some((argument) => argument.getText() === guard) ?? false;
}

function roles(node) {
  const call = decoratorCall(node, 'Roles');
  return call ? call.arguments.filter(ts.isStringLiteralLike).map((argument) => argument.text) : [];
}

const routeDecorators = new Map([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
]);
const routes = [];

for (const file of files.sort()) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name) continue;
    const controller = decoratorCall(statement, 'Controller');
    if (!controller) continue;
    const controllerName = statement.name.text;
    const prefix = literalArgument(controller);
    const classPublic = Boolean(decoratorCall(statement, 'Public'));
    const classJwt = hasGuard(statement, 'JwtAuthGuard');
    const classRoles = roles(statement);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue;
      const route = [...routeDecorators].map(([name, method]) => ({ call: decoratorCall(member, name), method })).find((item) => item.call);
      if (!route) continue;
      const suffix = literalArgument(route.call);
      const publicRoute = classPublic || Boolean(decoratorCall(member, 'Public'));
      const jwt = classJwt || hasGuard(member, 'JwtAuthGuard');
      const effectiveRoles = [...new Set([...classRoles, ...roles(member)])];
      const customPolicy = customPolicies.get(controllerName);
      const policy = publicRoute
        ? 'PUBLIC_EXPLICIT'
        : jwt
          ? effectiveRoles.length > 0 ? 'JWT_ROLES' : 'JWT_AUTHENTICATED'
          : customPolicy ?? 'UNCLASSIFIED';
      routes.push({
        method: route.method,
        path: `/${[prefix, suffix].filter(Boolean).join('/')}`,
        controller: controllerName,
        handler: member.name.getText(),
        policy,
        roles: effectiveRoles,
        source: path.relative(root, file),
      });
    }
  }
}

const unclassified = routes.filter((route) => route.policy === 'UNCLASSIFIED');
const counts = Object.fromEntries([...new Set(routes.map((route) => route.policy))].sort().map((policy) => [policy, routes.filter((route) => route.policy === policy).length]));
const result = { status: unclassified.length === 0 ? 'PASS' : 'FAIL', controllers: files.length, routes: routes.length, counts, unclassified, routesDetail: routes };
const output = process.env.EPHEMERAL_RBAC_SOURCE_OUTPUT;
if (output) fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...result, routesDetail: undefined })}\n`);
if (unclassified.length > 0) process.exitCode = 1;
