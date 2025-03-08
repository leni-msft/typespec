import "./decorators.tsp";
import "../dist/src/validate.js";

using TypeSpec.Versioning;

#suppress "projections-are-experimental"
projection op#v {
  to(version) {
    if !existsAtVersion(self, version) {
      return never;
    };
    if hasDifferentNameAtVersion(self, version) {
      self::rename(getNameAtVersion(self, version));
    };
    if hasDifferentReturnTypeAtVersion(self, version) {
      self::changeReturnType(getReturnTypeBeforeVersion(self, version));
    };
  }
  from(version) {
    if !existsAtVersion(self, version) {
      return never;
    };
    if hasDifferentNameAtVersion(self, version) {
      self::rename(self::projectionBase::name);
    };
  }
}

#suppress "projections-are-experimental"
projection interface#v {
  to(version) {
    if !existsAtVersion(self, version) {
      return never;
    };
    if hasDifferentNameAtVersion(self, version) {
      self::rename(getNameAtVersion(self, version));
    };
    self::operations::forEach((operation) => {
      if !existsAtVersion(operation, version) {
        self::deleteOperation(operation::name);
      };
      if hasDifferentReturnTypeAtVersion(operation, version) {
        operation::changeReturnType(getReturnTypeBeforeVersion(operation, version));
      };
    });
  }
  from(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(self::projectionBase::name);
      };

      self::projectionBase::operations::forEach((operation) => {
        if !existsAtVersion(operation, version) {
          self::addOperation(operation::name, operation::parameters, operation::returnType);
        };
      });
    };
  }
}

#suppress "projections-are-experimental"
projection union#v {
  to(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(getNameAtVersion(self, version));
      };

      self::variants::forEach((variant) => {
        if !existsAtVersion(variant, version) {
          self::deleteVariant(variant::name);
        } else if hasDifferentNameAtVersion(variant, version) {
          self::renameVariant(variant::name, getNameAtVersion(variant, version));
        };
      });
    };
  }
  from(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(self::projectionBase::name);
      };

      self::projectionBase::variants::forEach((variant) => {
        if !existsAtVersion(variant, version) {
          self::addVariant(variant::name, variant::type);
        } else if hasDifferentNameAtVersion(variant, version) {
          self::renameVariant(getNameAtVersion(variant, version), variant::name);
        };
      });
    };
  }
}

#suppress "projections-are-experimental"
projection model#v {
  to(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(getNameAtVersion(self, version));
      };

      self::properties::forEach((p) => {
        if !existsAtVersion(p, version) {
          self::deleteProperty(p::name);
        };

        if hasDifferentNameAtVersion(p, version) {
          self::renameProperty(p::name, getNameAtVersion(p, version));
        };

        if madeOptionalAfter(p, version) {
          p::setOptional(false);
        };

        if hasDifferentTypeAtVersion(p, version) {
          self::changePropertyType(p::name, getTypeBeforeVersion(p, version));
        };
      });
    };
  }
  from(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(self::projectionBase::name);
      };

      self::projectionBase::properties::forEach((p) => {
        if !existsAtVersion(p, version) {
          self::addProperty(p::name, p::type);
        };

        if hasDifferentNameAtVersion(p, version) {
          self::renameProperty(getNameAtVersion(p, version), p::name);
        };

        if madeOptionalAfter(p, version) {
          p::setOptional(true);
        };

        if hasDifferentTypeAtVersion(p, version) {
          self::changePropertyType(p::name, p::type);
        };
      });
    };
  }
}

#suppress "projections-are-experimental"
projection enum#v {
  to(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(getNameAtVersion(self, version));
      };

      self::members::forEach((m) => {
        if !existsAtVersion(m, version) {
          self::deleteMember(m::name);
        };

        if hasDifferentNameAtVersion(m, version) {
          self::renameMember(m::name, getNameAtVersion(m, version));
        };
      });
    };
  }
  from(version) {
    if !existsAtVersion(self, version) {
      return never;
    } else {
      if hasDifferentNameAtVersion(self, version) {
        self::rename(self::projectionBase::name);
      };

      self::projectionBase::members::forEach((m) => {
        if !existsAtVersion(m, version, self::projectionBase) {
          self::addMember(m::name, m::type);
        };

        if hasDifferentNameAtVersion(m, version, self::projectionBase) {
          self::renameMember(getNameAtVersion(m, version), m::name);
        };
      });
    };
  }
}
