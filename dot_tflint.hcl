config {
  plugin_dir = "~/.tflint.d/plugins"

  format = "compact"
  call_module_type = "all"
  force = false
  disabled_by_default = false

  ignore_module = {}
}


###################################################
# Rule Sets - Terraform
###################################################

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

rule "terraform_comment_syntax" {
  enabled = true
}

rule "terraform_naming_convention" {
  enabled = true
  format = "snake_case"

  custom_formats = {
    extended_snake_case = {
      description = "Extended snake_case Format which allows double underscore like `a__b`."
      regex       = "^[a-z][a-z0-9]+([_]{1,2}[a-z0-9]+)*$"
    }
  }

  module {
    format = "extended_snake_case"
  }

  resource {
    format = "extended_snake_case"
  }

  data {
    format = "extended_snake_case"
  }
}

rule "terraform_unused_declarations" {
  enabled = false
}

rule "terraform_unused_required_providers" {
  enabled = true
}

rule "terraform_workspace_remote" {
  enabled = false
}


###################################################
# Rule Sets - AWS
###################################################

plugin "aws" {
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
  version = "0.26.0"

  enabled = true
  deep_check = false
}
