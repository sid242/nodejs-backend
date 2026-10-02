/** validate({ body, query, params }) with zod schemas. Parsed values land in req.valid. */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    if (schemas[part]) req.valid[part] = schemas[part].parse(req[part]);
  }
  next();
};
